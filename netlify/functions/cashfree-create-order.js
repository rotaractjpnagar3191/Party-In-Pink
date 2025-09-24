const crypto = require('crypto')
const cfg = require('../../config/event.json')
const { appendJSONL, readJSONL } = require('../utils/githubStore')

function isOnSale(t){ const now = Date.now(); return now >= Date.parse(t.saleStart) && now <= Date.parse(t.saleEnd) }

exports.handler = async (event) => {
  if(event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }
  try{
    const { name, email, phone, ticket, quantity = 1, coupon = '', donation = 0 } = JSON.parse(event.body || '{}')
    if(!name || !email || !phone || !ticket) return { statusCode: 400, body: 'Missing fields' }

    const tier = cfg.tickets.find(t => t.id === ticket)
    if(!tier) return { statusCode: 400, body: 'Invalid ticket' }
    if(!isOnSale(tier)) return { statusCode: 400, body: 'This ticket is not on sale' }

    const orders = await readJSONL('orders.jsonl')
    const payments = await readJSONL('payments.jsonl')
    const paidSet = new Set(payments.map(p => p.order_id))
    const sold = orders.filter(o => o.tier === tier.id && paidSet.has(o.order_id)).reduce((s, o) => s + Number(o.qty||0), 0)
    const left = Math.max(0, tier.quantity - sold)
    const qty = Math.max(1, Math.min(Number(quantity), tier.maxPerOrder))
    if(left < qty) return { statusCode: 400, body: 'Not enough tickets left' }

    // Coupon calculation (usage limit via counting PAID rows)
    let discount = 0; let couponRec = null
    if(coupon){
      const code = cfg.coupons.find(c => c.code.toLowerCase() === String(coupon).toLowerCase())
      if(!code) return { statusCode: 400, body: 'Invalid coupon' }
      if(!code.appliesTo.includes(tier.id)) return { statusCode: 400, body: 'Coupon not applicable' }
      couponRec = code
      discount = code.type === 'percent' ? Math.round((tier.price * qty) * (code.value/100)) : Math.round(code.value)
      const used = orders.filter(o => (o.coupon||'').toLowerCase() === code.code.toLowerCase() && paidSet.has(o.order_id)).length
      if(code.maxUses && used >= code.maxUses) return { statusCode: 400, body: 'Coupon limit reached' }
    }

    const donationAmt = Math.max(0, Number(donation) || 0)
    const subtotal = tier.price * qty
    const orderAmount = Math.max(1, subtotal - discount + donationAmt)

    const orderId = 'pip_' + crypto.randomUUID().replace(/-/g,'').slice(0,20)
    const BASE = process.env.CASHFREE_ENV === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com'

    // Save draft order event
    await appendJSONL('orders.jsonl', {
      order_id: orderId, name, email, phone,
      tier: tier.id, qty, amount: orderAmount, coupon: couponRec?.code || '',
      discount, donation: donationAmt, status: 'PENDING', created_at: new Date().toISOString()
    })

    const payload = {
      order_id: orderId,
      order_amount: orderAmount,
      order_currency: cfg.event.currency || 'INR',
      customer_details: { customer_id: email, customer_email: email, customer_phone: phone, customer_name: name },
      order_meta: { return_url: `${process.env.SITE_URL}/success.html?order_id={order_id}` }
    }

    const cfRes = await fetch(`${BASE}/pg/orders`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-client-id': process.env.CASHFREE_APP_ID, 'x-client-secret': process.env.CASHFREE_SECRET_KEY },
      body: JSON.stringify(payload)
    })
    const out = await cfRes.json().catch(()=>null)
    if(!cfRes.ok) return { statusCode: 400, body: out?.message || 'Cashfree order creation failed' }

    return { statusCode: 200, body: JSON.stringify(out) }
  }catch(err){ return { statusCode: 500, body: 'Server error' } }
}
