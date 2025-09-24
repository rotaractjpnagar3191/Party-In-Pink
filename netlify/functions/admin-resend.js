const sg = require('@sendgrid/mail')
if(process.env.SENDGRID_API_KEY){ sg.setApiKey(process.env.SENDGRID_API_KEY) }

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {}
  if(qs.key !== process.env.ADMIN_KEY) return { statusCode: 401, body: 'Unauthorized' }
  if(!process.env.SENDGRID_API_KEY) return { statusCode: 400, body: 'Email not configured' }
  const orderId = qs.order_id
  if(!orderId) return { statusCode: 400, body: 'order_id required' }
  const link = `${process.env.SITE_URL}/api/ticket?order_id=${encodeURIComponent(orderId)}`
  const to = qs.email
  if(!to) return { statusCode: 400, body: 'email required' }
  await sg.send({ to, from: process.env.TICKETS_FROM_EMAIL, subject: 'Your PiP 4.0 Ticket', html: `Download your ticket: <a href="${link}">Ticket (PDF)</a>` })
  return { statusCode: 200, body: JSON.stringify({ ok:true }) }
}
