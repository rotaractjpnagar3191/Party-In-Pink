const cfg = require('../../config/event.json')
const { readJSONL } = require('../utils/githubStore')
function onSale(t){ const n=Date.now(); return n>=Date.parse(t.saleStart) && n<=Date.parse(t.saleEnd) }

exports.handler = async () => {
  const orders = await readJSONL('orders.jsonl')
  const pays = await readJSONL('payments.jsonl')
  const paid = new Set(pays.map(p => p.ref))
  const sold = {}
  for (const o of orders) if (paid.has(o.ref)) sold[o.tier] = (sold[o.tier]||0) + Number(o.qty||0)
  const tickets = cfg.tickets.map(t => ({
    id: t.id, name: t.name, price: t.price,
    onSale: onSale(t),
    available: Math.max(0, t.quantity - (sold[t.id]||0))
  }))
  return { statusCode: 200, body: JSON.stringify({ event: cfg.event, tickets, donation: cfg.donation }) }
}
