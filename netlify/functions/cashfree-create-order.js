// netlify/functions/cashfree-create-order.js
const crypto = require('crypto')
const cfg = require('../../config/event.json')
const { readJSONL, appendJSONL } = require('../utils/githubStore')

const BASE = process.env.CASHFREE_ENV === 'production'
  ? 'https://api.cashfree.com'
  : 'https://sandbox.cashfree.com'

function onSale(t){ const n=Date.now(); return n>=Date.parse(t.saleStart) && n<=Date.parse(t.saleEnd) }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }
  try {
    const { tier, qty=1, name, email, phone } = JSON.parse(event.body || '{}')
    if (!tier || !name || !email || !phone) return { statusCode: 400, body: 'Missing fields' }

    const t = cfg.tickets.find(x => x.id === tier)
    if (!t) return { statusCode: 400, body: 'Invalid tier' }
    if (!onSale(t)) return { statusCode: 400, body: 'Tier not on sale' }

    // inventory from PAID orders only
    const orders = await readJSONL('orders.jsonl')
    const pays   = await readJSONL('payments.jsonl')
    const paid = new Set(pays.map(p => p.ref))
    const sold = orders.filter(o => o.tier===tier && paid.has(o.ref))
                       .reduce((s,o)=>s + Number(o.qty||0), 0)
    const left = Math.max(0, t.quantity - sold)
    const q = Math.max(1, Math.min(Number(qty)||1, t.maxPerOrder||10))
    if (left < q) return { statusCode: 400, body: 'Not enough tickets left' }

    const amount = t.price * q
    const order_id = 'pip_' + crypto.randomUUID().replace(/-/g,'').slice(0,20)

    // record draft order
    await appendJSONL('orders.jsonl', {
      ref: order_id, name, email, phone, tier, qty: q, amount,
      status: 'PENDING', created_at: new Date().toISOString()
    })

    // create PG Order (Hosted Checkout)
    const res = await fetch(`${BASE}/pg/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_APP_ID,
        'x-client-secret': process.env.CASHFREE_SECRET_KEY,
        'x-api-version': process.env.CASHFREE_API_VERSION || '2025-01-01'
      },
      body: JSON.stringify({
        order_id,
        order_amount: amount,
        order_currency: cfg.event.currency || 'INR',
        customer_details: {
          customer_id: email, // any unique string
          customer_name: name,
          customer_email: email,
          customer_phone: phone
        },
        order_meta: {
          return_url: `${process.env.SITE_URL}/success.html?ref={order_id}`
        },
        order_tags: { tier, qty: q }
      })
    })

    const json = await res.json().catch(()=>null)
    if (!res.ok || !json?.payment_session_id) {
      return { statusCode: 400, body: (json && (json.message||json.error)) || 'Failed to create order' }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ref: order_id,
        payment_session_id: json.payment_session_id,
        mode: process.env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox'
      })
    }
  } catch (e) {
    return { statusCode: 500, body: 'Server error' }
  }
}
