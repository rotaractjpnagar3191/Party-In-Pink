const PDFDocument = require('pdfkit')
const QRCode = require('qrcode')
const { readJSONL } = require('../utils/githubStore')

function pdfToBuffer(doc){
  return new Promise((resolve, reject) => {
    const chunks = []
    doc.on('data', c => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
}

exports.handler = async (event) => {
  const orderId = (event.queryStringParameters || {}).order_id
  if(!orderId) return { statusCode: 400, body: 'order_id required' }
  const payments = await readJSONL('payments.jsonl')
  const paid = payments.some(p => p.order_id === orderId)
  if(!paid) return { statusCode: 400, body: 'Payment not confirmed' }

  const orders = await readJSONL('orders.jsonl')
  const r = orders.find(o => o.order_id === orderId)
  if(!r) return { statusCode: 400, body: 'Order not found' }

  const { name, email, phone, tier, qty } = r
  const qrData = JSON.stringify({ order_id: orderId, name, email, phone, qty })
  const qrPng = await QRCode.toBuffer(qrData, { width: 240 })

  const doc = new PDFDocument({ size: 'A5', margin: 36 })
  doc.fillColor('#c42460').fontSize(22).text('Party in Pink 4.0')
  doc.moveDown(0.4)
  doc.fillColor('#111').fontSize(12).text('Date: Sun, 12 Oct 2025 • 7:00 AM')
  doc.text('Venue: BIT, VV Puram, Bengaluru')
  doc.moveDown(0.8)
  doc.fontSize(14).text(`Name: ${name}`)
  doc.text(`Ticket: ${tier} × ${qty}`)
  doc.text(`Order: ${orderId}`)
  doc.image(qrPng, doc.page.width - 36 - 140, 36 + 40, { width: 140 })
  doc.moveDown(1.2)
  doc.fontSize(10).fillColor('#555').text('Show this ticket at entry. Non‑transferable.')

  const buffer = await pdfToBuffer(doc)
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=PiP4_Ticket_${orderId}.pdf`
    },
    body: buffer.toString('base64'),
    isBase64Encoded: true
  }
}
