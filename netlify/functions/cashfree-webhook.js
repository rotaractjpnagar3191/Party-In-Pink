const crypto = require('crypto')
const { appendJSONL } = require('../utils/githubStore')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }

  // Get the raw body exactly as Cashfree sent it
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '')

  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(
    ([k,v]) => [k.toLowerCase(), v]
  ))
  const sig = headers['x-webhook-signature']
  const ts  = headers['x-webhook-timestamp']

  // Cashfree signature = HMAC_SHA256( ts + rawBody, CASHFREE_SECRET_KEY ) in Base64
  const expected = crypto.createHmac('sha256', process.env.CASHFREE_SECRET_KEY)
    .update(String(ts || '') + raw)
    .digest('base64')

  if (!sig || sig !== expected) {
    return { statusCode: 401, body: 'Invalid signature' }
  }

  // Process payload
  const payload = JSON.parse(raw)

  // Payment Links: link_status === 'PAID'
  const linkStatus = payload?.data?.link_status || payload?.data?.link?.link_status
  const linkId     = payload?.data?.link_id     || payload?.data?.link?.link_id

  // PG Orders (Hosted Checkout): look for order status fields
  const orderStatus = payload?.data?.order?.order_status || payload?.data?.status
  const orderId     = payload?.data?.order?.order_id     || payload?.data?.order_id

  const ref = linkId || orderId

  const paid =
    (String(linkStatus).toUpperCase() === 'PAID') ||
    (String(orderStatus).toUpperCase() === 'PAID' || String(orderStatus).toUpperCase() === 'SUCCESS')

  if (ref && paid) {
    await appendJSONL('payments.jsonl', { ref, paid_at: new Date().toISOString() })
  }

  // Always 200 to stop retries (after you’ve safely processed & stored the event)
  return { statusCode: 200, body: JSON.stringify({ ok: true }) }
}
