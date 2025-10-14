// netlify/functions/cf-webhook.js
const crypto = require('crypto');
const { getConfig, mapAmountToPasses } = require('./_config');
const { getJson, putJson } = require('./_github');
const { issueComplimentaryPasses } = require('./_konfhub');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return respond(405, 'Method not allowed');

    const CFG = getConfig();
    const ENV = CFG.private;

    // set ALLOW_TEST_PING=1 locally if you want to bypass signature & SUCCESS checks
    const ALLOW_TEST_PING = process.env.ALLOW_TEST_PING === '1';

    // --- Verify Cashfree signature ---
    const sig = event.headers['x-webhook-signature'];
    const ts  = event.headers['x-webhook-timestamp'];
    if (!sig || !ts) return respond(ALLOW_TEST_PING ? 200 : 400, 'Missing signature headers');

    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '');

    const SECRET = process.env.CF_WEBHOOK_SECRET || ENV.CASHFREE_SECRET_KEY;
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(ts + raw.toString('utf8'))
      .digest('base64');

    if (expected !== sig) return respond(ALLOW_TEST_PING ? 200 : 401, 'Invalid signature');

    // --- Parse payload ---
    const payload = JSON.parse(raw.toString('utf8'));
    const data = payload?.data || payload;

    const status   = data?.payment?.payment_status || data?.payment_status || data?.status;
    const order_id = data?.order?.order_id || data?.order_id;
    const paidAmt  = Number(data?.order?.order_amount || data?.order_amount || 0);

    if (!order_id) return respond(ALLOW_TEST_PING ? 200 : 400, 'No order_id');
    if (status !== 'SUCCESS' && ALLOW_TEST_PING) return respond(200, 'Test ping accepted');
    if (status !== 'SUCCESS') return respond(200, 'Ignoring non-success');

    // --- Load stored order context ---
    const path = `${ENV.STORE_PATH}/orders/${order_id}.json`;
    const oc   = await getJson(ENV, path);
    if (!oc) return respond(ALLOW_TEST_PING ? 200 : 404, 'Order context not found');

    if (oc.fulfilled) {
      // idempotent
      return respond(200, 'Already fulfilled');
    }

    // Audit payload
    oc.cashfree = oc.cashfree || {};
    oc.cashfree.webhook = data;
    oc.cashfree.webhook_received_at = new Date().toISOString();

    // --- Compute passes/amount (server as source of truth) ---
    if (oc.type === "bulk") {
      oc.passes = Number(oc.meta?.quantity || oc.passes || 0);
      // amount usually pre-set during create-order; keep as-is
    } else {
      oc.amount = paidAmt;
      // Below-minimum now grants 1 complimentary pass
      oc.passes = mapAmountToPasses(
        paidAmt,
        CFG.public.SLABS,
        1,
        ENV.SLAB_ABOVE_MAX
      );
    }

    // --- Issue via KonfHub (KonfHub sends attendee emails) ---
    let issued;
    try {
      issued = await issueComplimentaryPasses(ENV, oc);
    } catch (e) {
      oc.fulfilled = { at: new Date().toISOString(), status: 'failed' };
      oc.issuance_error = String(e && e.message ? e.message : e);
      await putJson(ENV, path, oc);
      console.error('Issuance failed:', oc.issuance_error);
      return respond(500, 'Issuance failed');
    }

    oc.konfhub = {
      ticket_id_used:
        oc.type === 'bulk'
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

    // No emails from webhook — KonfHub handles attendee mails.
    // Admin notifications can be checked in the dashboard/logs.

    return respond(200, `Issued ${oc.passes} pass(es)`);
  } catch (e) {
    console.error('cf-webhook error', e);
    return respond(500, e.message || 'Webhook error');
  }
};

const respond = (statusCode, body) => ({
  statusCode,
  body: typeof body === 'string' ? body : JSON.stringify(body)
});
