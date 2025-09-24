const PDFDocument = require('pdfkit')
const QRCode = require('qrcode')
const { readJSONL } = require('../utils/githubStore')

function toBuf(doc){ return new Promise((res,rej)=>{ const chunks=[]; doc.on('data',c=>chunks.push(c)); doc.on('end',()=>res(Buffer.concat(chunks))); doc.on('error',rej) }) }

exports.handler = async (event) => {
  const ref = (event.queryStringParameters||{}).ref
  if (!ref) return { statusCode: 400, body: 'ref required' }

  const pays = await readJSONL('payments.jsonl')
  const paid = pays.some(p => p.ref === ref)
  if (!paid) return { statusCode: 400, body: 'Payment not confirmed' }

  const orders = await readJSONL('orders.jsonl')
  const ord = orders.find(o => o.ref === ref)
  if (!ord) return { statusCode: 404, body: 'Order not found' }

  const qrPng = await QRCode.toBuffer(JSON.stringify({ ref, name: ord.name, email: ord.email, phone: ord.phone, qty: ord.qty }), { width: 240 })
  const doc = new PDFDocument({ size: 'A5', margin: 36 })
  doc.fillColor('#c42460').fontSize(22).text('Party in Pink 4.0')
  doc.moveDown(0.4).fillColor('#111').fontSize(12)
  doc.text('Date: Sun, 12 Oct 2025 • 7:00 AM')
  doc.text('Venue: BIT, VV Puram, Bengaluru')
  doc.moveDown(0.8).fontSize(14)
  doc.text(`Name: ${ord.name}`); doc.text(`Ticket: ${ord.tier} × ${ord.qty}`); doc.text(`Ref: ${ref}`)
  doc.image(qrPng, doc.page.width - 36 - 140, 36 + 40, { width: 140 })
  doc.moveDown(1.2).fontSize(10).fillColor('#555').text('Show this ticket at entry. Non-transferable.')

  const buf = await toBuf(doc)
  return {
    statusCode: 200,
    headers: {
      'Content-Type':'application/pdf',
      'Content-Disposition': `attachment; filename=PiP_Ticket_${ref}.pdf`
    },
    body: buf.toString('base64'),
    isBase64Encoded: true
  }
}
