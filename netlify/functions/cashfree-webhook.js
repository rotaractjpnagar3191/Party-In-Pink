const crypto = require('crypto')
const { appendJSONL } = require('../utils/githubStore')
// Optional email (SendGrid)
let sg = null
if (process.env.SENDGRID_API_KEY) {
  sg = require('@sendgrid/mail'); sg.setApiKey(process.env.SENDGRID_API_KEY)
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' }

  const raw = event.body || ''
  const sig = event.headers['x-webhook-signature'] || event.headers['X-Webhook-Signature']
  const expected = crypto.createHmac('sha256', process.env.CASHFREE_SECRET_KEY || '').update(raw).digest('base64')
  if (!sig || sig !== expected) return { statusCode: 401, body: 'Invalid signature' }

  const payload = JSON.parse(raw)
  // For Payment Link paid event, the ref we set is link_id == our 'ref'
  const ref = payload?.data?.link?.link_id || payload?.data?.order?.order_id || payload?.data?.link_id
  const status = payload?.data?.link?.link_status || payload?.data?.order?.order_status || payload?.data?.status

  if (ref && String(status).toUpperCase() === 'PAID') {
    await appendJSONL('payments.jsonl', { ref, paid_at: new Date().toISOString() })

    // Optional email with direct ticket link if you want
    if (sg && process.env.TICKETS_FROM_EMAIL) {
      const link = `${process.env.SITE_URL}/api/ticket?ref=${encodeURIComponent(ref)}`
      try {
        // You could look up name/email from orders.jsonl here if needed
        await sg.send({
          to: { email: payload?.data?.customer_details?.customer_email || '', name: payload?.data?.customer_details?.customer_name || 'Participant' },
          from: process.env.TICKETS_FROM_EMAIL,
          subject: 'Your PiP Ticket',
          html: `Thanks for registering. Download your ticket: <a href="${link}">Ticket (PDF)</a>`
        })
      } catch {}
    }
  }
  return { statusCode: 200, body: JSON.stringify({ ok: true }) }
}
