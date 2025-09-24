const { appendJSONL } = require('../utils/githubStore')

exports.handler = async (event) => {
  if(event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }
  const qs = event.queryStringParameters || {}
  if(qs.key !== process.env.ADMIN_KEY) return { statusCode: 401, body: JSON.stringify({ error:'Unauthorized' }) }
  const orderId = qs.order_id
  if(!orderId) return { statusCode: 400, body: JSON.stringify({ error:'order_id required' }) }
  await appendJSONL('checkins.jsonl', { order_id: orderId, checked_in_at: new Date().toISOString() })
  return { statusCode: 200, body: JSON.stringify({ ok:true }) }
}
