const crypto = require('crypto')
const sg = require('@sendgrid/mail')
const { appendJSONL, readJSONL } = require('../utils/githubStore')
if(process.env.SENDGRID_API_KEY){ sg.setApiKey(process.env.SENDGRID_API_KEY) }

exports.handler = async (event) => {
  if(event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }
  const raw = event.body || ''
  const sig = event.headers['x-webhook-signature'] || event.headers['X-Webhook-Signature']
  const expected = crypto.createHmac('sha256', process.env.CASHFREE_SECRET_KEY || '').update(raw).digest('base64')
  if(!sig || sig !== expected) return { statusCode: 401, body: 'Invalid signature' }

  const evt = JSON.parse(raw)
  const orderId = evt?.data?.order?.order_id || evt?.data?.order_id
  const status = evt?.data?.order?.order_status || evt?.data?.status
  if(!orderId) return { statusCode: 200, body: JSON.stringify({ ok:true }) }

  if(status === 'PAID'){
    // append a payment event
    await appendJSONL('payments.jsonl', { order_id: orderId, paid_at: new Date().toISOString() })

    // Optional: email
    if(process.env.SENDGRID_API_KEY){
      // Lookup order to get email/name
      const orders = await readJSONL('orders.jsonl')
      const ord = orders.find(o => o.order_id === orderId)
      const email = ord?.email; const name = ord?.name || 'Participant'
      if(email){
        const link = `${process.env.SITE_URL}/api/ticket?order_id=${encodeURIComponent(orderId)}`
        try{ await sg.send({ to: { email, name }, from: process.env.TICKETS_FROM_EMAIL, subject: 'Your PiP 4.0 Ticket', html: `Hi ${name.split(' ')[0]},<br/>Download your ticket: <a href="${link}">Ticket (PDF)</a>` }) }catch{}
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ ok:true }) }
}
