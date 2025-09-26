// netlify/functions/_mail.js
const nodemailer = require('nodemailer');

/* ---------- Primary SMTP (e.g., Brevo) ---------- */
function buildSmtpTransport(env){
  const { SMTP_HOST, SMTP_PORT = 587, SMTP_USER, SMTP_PASS } = env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST, port: Number(SMTP_PORT), secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function sendMail(env, { to, subject, html, text, from }){
  const transport = buildSmtpTransport(env);
  if (!transport) return { skipped: true };
  const { FROM_EMAIL = 'tickets@rotaractjpnagar.org', REPLY_TO } = env;
  const info = await transport.sendMail({
    from: from || FROM_EMAIL, to, replyTo: REPLY_TO || undefined, subject, text, html
  });
  return { messageId: info.messageId };
}

/* ---------- Gmail (App Password) for donor thank-you ---------- */
function buildGmailTransport(env){
  const { GMAIL_USER, GMAIL_APP_PASSWORD } = env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
}

async function sendMailFromGmail(env, { to, subject, html, text }){
  const t = buildGmailTransport(env);
  if (!t) return { skipped: true };
  const info = await t.sendMail({
    from: env.GMAIL_USER, to,
    replyTo: env.REPLY_TO || env.GMAIL_USER,
    subject, text, html
  });
  return { messageId: info.messageId };
}

/* ---------- Templates ---------- */
function emailTemplates(){
  return {
    purchaser({ type, amount, passes, recipients, meta }){
      const title = 'Party in Pink 4.0 — Payment confirmed ✓';
      const list = (recipients || []).map(e=>`• ${e}`).join('<br>');
      const detail = type === 'bulk'
        ? `<p><strong>Bulk purchase</strong><br>Club: ${meta?.club_name || '-'}<br>Type: ${meta?.club_type}<br>Quantity: ${passes}</p>`
        : `<p><strong>Donation</strong><br>Amount: ₹${amount}<br>Complimentary passes: ${passes}</p>`;
      const html = `
        <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6">
          <h2>${title}</h2>
          ${detail}
          <p>Tickets are being issued by KonfHub to the recipients below:</p>
          <p>${list || '• ' + (meta?.email || '')}</p>
          <hr style="border:none;border-top:1px solid #eee;margin:16px 0;">
          <p><strong>Event:</strong> Party in Pink 4.0<br>
             <strong>When:</strong> Sun, 12 Oct 2025 · 7:00 AM<br>
             <strong>Where:</strong> BIT, VV Puram, Bengaluru</p>
          <p>If anything looks off, reply to this email and we’ll help.</p>
        </div>`;
      const text = `Payment confirmed.
${type==='bulk'
  ? `Bulk: ${meta?.club_type} ${passes} passes | ${meta?.club_name || ''}`
  : `Donation: ₹${amount} | ${passes} passes`}
Recipients:
${(recipients || []).join('\n')}

Event: Party in Pink 4.0 — Sun, 12 Oct 2025 7:00 AM — BIT, VV Puram, Bengaluru`;
      return { subject: title, html, text };
    },

    donorThanks({ amount }){
      const subject = `Thank you for your donation — ₹${amount}`;
      const html = `
        <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6">
          <p>Thank you for your generous donation of <strong>₹${amount}</strong> to <em>Party in Pink 4.0</em>.</p>
          <p>Your complimentary passes (if applicable) are being issued by KonfHub and will arrive shortly.</p>
          <p>Date/Time: <strong>12 Oct 2025, 7:00 AM</strong><br>Venue: <strong>BIT, VV Puram, Bengaluru</strong></p>
          <p>We appreciate your support! 💗</p>
        </div>`;
      const text = `Thanks for your donation of ₹${amount}.
Your complimentary passes (if applicable) will be emailed by KonfHub shortly.
Event: 12 Oct 2025, 7:00 AM — BIT, VV Puram, Bengaluru.`;
      return { subject, html, text };
    },

    recipient({ type }){
      const subject = 'Your Pink Pass is on the way — Party in Pink 4.0';
      const html = `
        <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6">
          <p>Hi! You’ve been allocated a <strong>Pink Pass</strong> for Party in Pink 4.0 (${type}).</p>
          <p>Your official ticket email will arrive from KonfHub shortly.</p>
          <p><strong>Date/Time:</strong> 12 Oct 2025, 7:00 AM<br>
             <strong>Venue:</strong> BIT, VV Puram, Bengaluru</p>
          <p>See you there! 💗</p>
        </div>`;
      const text = `Your Pink Pass is on the way.
KonfHub will email your ticket shortly.
Event: 12 Oct 2025, 7:00 AM — BIT, VV Puram, Bengaluru.`;
      return { subject, html, text };
    },

    adminFailure({ order_id, reason, errors }){
      const subject = `⚠️ PiP issuance issue — order ${order_id}`;
      const html = `
        <div style="font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.6">
          <p>Order <strong>${order_id}</strong> had errors during ticket issuance.</p>
          <p><strong>Reason:</strong> ${reason || '-'}</p>
          <pre style="white-space:pre-wrap;background:#f7f7f7;padding:8px;border-radius:6px">${errors ? JSON.stringify(errors,null,2) : ''}</pre>
        </div>`;
      const text = `Order ${order_id} had errors.
Reason: ${reason}
${errors ? JSON.stringify(errors) : ''}`;
      return { subject, html, text };
    }
  };
}

module.exports = { sendMail, sendMailFromGmail, emailTemplates };
