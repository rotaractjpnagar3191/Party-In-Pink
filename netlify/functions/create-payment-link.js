const crypto = require('crypto')
const cfg = require('../../config/event.json')
const { appendJSONL, readJSONL } = require('../utils/githubStore')

function onSale(t){ const n=Date.now(); return n>=Date.parse(t.saleStart) && n<=Date.parse(t.saleEnd) }
const BASE = (process.env.CASHFREE_ENV === 'production') ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com'

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }
  try {
    const { tier, qty=1, name, email, phone } = JSON.parse(event.body || '{}')
    if (!tier || !name || !email || !phone) return { statusCode: 400, body: 'Missing fields' }
    const t = cfg.tickets.find(x => x.id === tier)
    if (!t) return { statusCode: 400, body: 'Invalid tier' }
    if (!onSale(t)) return { statusCode: 400, body: 'Tier not on sale' }

    // inventory check (PAID only)
    const orders = await readJSONL('orders.jsonl')
    const pays = await readJSONL('payments.jsonl')
    const paid = new Set(pays.map(p => p.ref))
    const sold = orders.filter(o => o.tier === tier && paid.has(o.ref)).reduce((s,o)=>s+Number(o.qty||0),0)
    const left = Math.max(0, t.quantity - sold)
    const q = Math.max(1, Math.min(Number(qty)||1, t.maxPerOrder||10))
    if (left < q) return { statusCode: 400, body: 'Not enough tickets left' }

    const amount = t.price * q
    const ref = 'pip_' + crypto.randomUUID().replace(/-/g,'').slice(0,20)

    // Record draft order
    await appendJSONL('orders.jsonl', {
      ref, name, email, phone, tier, qty: q, amount, status: 'PENDING', created_at: new Date().toISOString()
    })

    // Create Payment Link (hosted page)
    const pl = await fetch(`${BASE}/pg/links`, {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        'x-client-id': process.env.CASHFREE_APP_ID,
        'x-client-secret': process.env.CASHFREE_SECRET_KEY,
        'x-api-version': process.env.CASHFREE_API_VERSION || '2025-01-01'
      },
      body: JSON.stringify({
        link_id: ref,
        link_amount: amount,
        link_currency: cfg.event.currency || 'INR',
        link_purpose: `${cfg.event.title} Ticket`,
        customer_details: { customer_name: name, customer_email: email, customer_phone: phone },
        link_meta: { return_url: `${process.env.SITE_URL}/success.html?ref=${encodeURIComponent(ref)}` },
        link_notes: { tier, qty: q }
      })
    }).then(r=>r.json()).catch(()=>null)

    if (!pl || !(pl.link_url || pl.link_url)) {
      return { statusCode: 400, body: (pl && (pl.message||pl.error)) || 'Failed to create payment link' }
    }
    // Respond with URL to redirect client
    const link_url = pl.link_url || pl.url
    return { statusCode: 200, body: JSON.stringify({ ref, link_url }) }
  } catch (e) {
    return { statusCode: 500, body: 'Server error' }
  }
}
