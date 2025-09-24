const cfg = require('../../config/event.json')
const { readJSONL } = require('../utils/githubStore')

function isOnSale(t){ const now = Date.now(); return now >= Date.parse(t.saleStart) && now <= Date.parse(t.saleEnd) }

exports.handler = async () => {
  // sold qty = sum of qty for orders that are PAID
  const orders = await readJSONL('orders.jsonl')
  const payments = await readJSONL('payments.jsonl')
  const paidSet = new Set(payments.map(p => p.order_id))

  const soldByTier = {}
  for(const o of orders){
    if(paidSet.has(o.order_id)){
      soldByTier[o.tier] = (soldByTier[o.tier] || 0) + Number(o.qty || 0)
    }
  }

  const enriched = cfg.tickets.map(t => ({
    id: t.id, name: t.name, price: t.price,
    available: Math.max(0, t.quantity - (soldByTier[t.id] || 0)),
    onSale: isOnSale(t)
  }))

  return { statusCode: 200, body: JSON.stringify({ event: cfg.event, tickets: enriched, donation: cfg.donation }) }
}
