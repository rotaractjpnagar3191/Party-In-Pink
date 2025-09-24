const { readJSONL } = require('../utils/githubStore')

exports.handler = async (event) => {
  const orderId = (event.queryStringParameters || {}).order_id
  if(!orderId){
    return { statusCode: 200, body: JSON.stringify({ price: 199 }) }
  }
  const payments = await readJSONL('payments.jsonl')
  const paid = payments.some(p => p.order_id === orderId)
  return { statusCode: 200, body: JSON.stringify({ status: paid ? 'PAID' : 'PENDING' }) }
}
