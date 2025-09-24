const { readJSONL } = require('../utils/githubStore')

exports.handler = async (event) => {
  if((event.queryStringParameters||{}).key !== process.env.ADMIN_KEY) return { statusCode: 401, body: 'Unauthorized' }
  const orders = await readJSONL('orders.jsonl')
  const payments = await readJSONL('payments.jsonl')
  const paidSet = new Set(payments.map(p => p.order_id))
  const head = ['order_id','name','email','phone','tier','qty','amount','coupon','discount','donation','paid_at']
  const rows = orders.filter(o => paidSet.has(o.order_id)).map(o => [
    o.order_id, o.name, o.email, o.phone, o.tier, o.qty, o.amount, o.coupon, o.discount, o.donation,
    (payments.find(p => p.order_id === o.order_id)?.paid_at || '')
  ])
  const csv = [head, ...rows].map(r=>r.map(x=>`"${String(x??'').replace(/"/g,'""')}"`).join(',')).join('\n')
  return { statusCode: 200, headers: { 'Content-Type':'text/csv', 'Content-Disposition':'attachment; filename=pip_attendees.csv' }, body: csv }
}
