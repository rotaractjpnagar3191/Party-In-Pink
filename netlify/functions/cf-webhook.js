// netlify/functions/cf-webhook.js
const crypto = require('crypto');
const { getConfig, mapAmountToPasses } = require('./_config');
const { getJson, putJson } = require('./_github');
const { issueComplimentaryPasses } = require('./_konfhub');
const { sendMail, sendMailFromGmail, emailTemplates } = require('./_mail');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return respond(405, 'Method not allowed');

    const CFG = getConfig();
    const ENV = CFG.private;

    const ALLOW_TEST_PING = process.env.ALLOW_TEST_PING === '1';

    // Verify signature
    const sig = event.headers['x-webhook-signature'];
    const ts  = event.headers['x-webhook-timestamp'];
    if (!sig || !ts) return respond(ALLOW_TEST_PING ? 200 : 400, 'Missing signature headers');

    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body || '');
    const SECRET = process.env.CF_WEBHOOK_SECRET || ENV.CASHFREE_SECRET_KEY;
    const expected = crypto.createHmac('sha256', SECRET).update(ts + raw.toString('utf8')).digest('base64');
    if (expected !== sig) return respond(ALLOW_TEST_PING ? 200 : 401, 'Invalid signature');

    const payload = JSON.parse(raw.toString('utf8'));
    const data = payload?.data || payload;

    const status   = data?.payment?.payment_status || data?.payment_status || data?.status;
    const order_id = data?.order?.order_id || data?.order_id;
    const paidAmt  = Number(data?.order?.order_amount || data?.order_amount || 0);

    if (!order_id) return respond(ALLOW_TEST_PING ? 200 : 400, 'No order_id');
    if (status !== 'SUCCESS' && ALLOW_TEST_PING) return respond(200, 'Test ping accepted');
    if (status !== 'SUCCESS') return respond(200, 'Ignoring non-success');

    // Load context
    const path = `${ENV.STORE_PATH}/orders/${order_id}.json`;
    const oc   = await getJson(ENV, path);
    if (!oc) return respond(ALLOW_TEST_PING ? 200 : 404, 'Order context not found');
    if (oc.fulfilled) return respond(200, 'Already fulfilled');

    // Audit payload
    oc.cashfree.webhook = data;

    // Compute passes (server truth)
    if (oc.type === 'bulk') {
      oc.passes = Number(oc.meta?.quantity || oc.passes || 0);
    } else {
      oc.amount = paidAmt;
      oc.passes = mapAmountToPasses(paidAmt, CFG.public.SLABS, ENV.SLAB_BELOW_MIN, ENV.SLAB_ABOVE_MAX);
    }

    // Issue passes (batch v2)
    let issued;
    try {
      issued = await issueComplimentaryPasses(ENV, oc);
    } catch (e) {
      oc.fulfilled = { at: new Date().toISOString(), status: 'failed' };
      oc.issuance_error = String(e);
      await putJson(ENV, path, oc);

      const { subject, html, text } = emailTemplates().adminFailure({ order_id, reason: e.message, errors: [] });
      await sendMail(ENV, { to: ENV.FROM_EMAIL, subject, html, text }).catch(()=>{});
      return respond(500, 'Issuance failed');
    }

    oc.konfhub = {
      ticket_id_used: oc.type === 'bulk'
        ? (ENV.KONFHUB_BULK_TICKET_ID || ENV.KONFHUB_FREE_TICKET_ID)
        : ENV.KONFHUB_FREE_TICKET_ID,
      registrations: issued.created
    };
    if (issued.errors?.length) oc.issuance_errors = issued.errors;

    oc.fulfilled = {
      at: new Date().toISOString(),
      status: issued.errors?.length ? 'partial' : 'ok',
      count: issued.total
    };

    await putJson(ENV, path, oc);

    // Purchaser confirmation (SMTP)
    try {
      const tpl = emailTemplates().purchaser({
        type: oc.type, amount: oc.amount, passes: oc.passes, recipients: oc.recipients, meta: oc.meta
      });
      await sendMail(ENV, { to: oc.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    } catch (e) { console.warn('Purchaser email failed:', e.message); }

    // Donor thank-you from Gmail (donations only)
    if (oc.type === 'donation' && ENV.GMAIL_USER && ENV.GMAIL_APP_PASSWORD) {
      try {
        const t = emailTemplates().donorThanks({ amount: oc.amount });
        await sendMailFromGmail(ENV, { to: oc.email, subject: t.subject, html: t.html, text: t.text });
      } catch (e) { console.warn('Gmail donor thank-you failed:', e.message); }
    }

    // Heads-up to recipients (non-blocking)
    try {
      const tplR = emailTemplates().recipient({ type: oc.type });
      const uniq = Array.from(new Set(oc.recipients || []));
      await Promise.all(uniq.map(to => sendMail(ENV, {
        to, subject: tplR.subject, html: tplR.html, text: tplR.text
      }).catch(()=>null)));
    } catch (e) { /* ignore */ }

    // Notify admin on partial issuance
    if (issued.errors?.length) {
      const { subject, html, text } = emailTemplates().adminFailure({
        order_id, reason: 'Partial issuance', errors: issued.errors
      });
      await sendMail(ENV, { to: ENV.FROM_EMAIL, subject, html, text }).catch(()=>{});
    }

    return respond(200, `Issued ${oc.passes} pass(es)`);
  } catch (e) {
    console.error('cf-webhook error', e);
    return respond(500, e.message);
  }
};

const respond = (statusCode, body) => ({
  statusCode,
  body: typeof body === 'string' ? body : JSON.stringify(body)
});
