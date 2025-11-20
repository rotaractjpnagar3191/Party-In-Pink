// netlify/functions/cf-webhook.js
const crypto = require('crypto');
const { getConfig, mapAmountToPasses } = require('./_config');
const { getJson, putJson } = require('./_github');
const { issueComplimentaryPasses } = require('./_konfhub');

exports.handler = async (event) => {
  console.log('[cf-webhook] ===== WEBHOOK START =====');
  console.log('[cf-webhook] Method:', event.httpMethod);
  console.log('[cf-webhook] Headers:', Object.keys(event.headers));
  
  try {
    if (event.httpMethod !== 'POST') return respond(405, 'Method not allowed');

    const CFG = getConfig();
    const ENV = CFG.private;
    
    console.log('[cf-webhook] Config loaded, ENV keys:', Object.keys(ENV).filter(k => k.includes('KONFHUB')));

    // set ALLOW_TEST_PING=1 locally if you want to bypass signature & SUCCESS checks
    const ALLOW_TEST_PING = process.env.ALLOW_TEST_PING === '1';
    console.log('[cf-webhook] ALLOW_TEST_PING:', ALLOW_TEST_PING);

    // --- Verify Cashfree signature ---
    const sig = event.headers['x-webhook-signature'];
    const ts  = event.headers['x-webhook-timestamp'];
    console.log('[cf-webhook] Signature present:', !!sig, 'Timestamp present:', !!ts);
    
    if (!sig || !ts) return respond(ALLOW_TEST_PING ? 200 : 400, 'Missing signature headers');

    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '');

    const SECRET = process.env.CF_WEBHOOK_SECRET || ENV.CASHFREE_SECRET_KEY;
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(ts + raw.toString('utf8'))
      .digest('base64');

    console.log('[cf-webhook] Signature match:', expected === sig);
    if (expected !== sig) return respond(ALLOW_TEST_PING ? 200 : 401, 'Invalid signature');

    // --- Parse payload ---
    const payload = JSON.parse(raw.toString('utf8'));
    const data = payload?.data || payload;

    const status   = data?.payment?.payment_status || data?.payment_status || data?.status;
    const order_id = data?.order?.order_id || data?.order_id;
    const paidAmt  = Number(data?.order?.order_amount || data?.order_amount || 0);

    console.log('[cf-webhook] Status:', status, 'OrderID:', order_id, 'Amount:', paidAmt);
    
    if (!order_id) return respond(ALLOW_TEST_PING ? 200 : 400, 'No order_id');
    if (status !== 'SUCCESS' && ALLOW_TEST_PING) return respond(200, 'Test ping accepted');
    if (status !== 'SUCCESS') return respond(200, 'Ignoring non-success');

    // --- Load stored order context ---
    const path = `${ENV.STORE_PATH}/orders/${order_id}.json`;
    let oc   = await getJson(ENV, path);
    
    // If order not found in storage, reconstruct from webhook payload
    if (!oc) {
      console.log(`Order ${order_id} not in storage, reconstructing from webhook...`);
      
      // Try to extract type from order_note (format: "type|tier|quantity")
      const note = data?.order?.order_note || '';
      const [noteType] = String(note).split('|');
      const inferredType = ['bulk', 'donation'].includes(String(noteType).toLowerCase()) 
        ? String(noteType).toLowerCase() 
        : 'donation';
      
      oc = {
        order_id,
        type: inferredType,  // Extracted from order_note or defaulted
        amount: paidAmt,
        passes: 1,  // Default, will be recalculated below
        email: data?.customer_details?.customer_email || 'unknown@example.com',
        phone: data?.customer_details?.customer_phone || '',
        name: data?.customer_details?.customer_name || 'Guest',
        recipients: [data?.customer_details?.customer_email || 'unknown@example.com'],
        created_at: new Date().toISOString(),
        reconstructed_from_webhook: true,
        note: `Reconstructed from webhook: ${note}`
      };
    }

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
    
    console.log('[cf-webhook] Computed passes:', oc.passes, 'Type:', oc.type, 'Amount:', oc.amount);
    console.log('[cf-webhook] Recipient emails:', oc.recipients);

    // --- Issue via KonfHub (KonfHub sends attendee emails) ---
    let issued;
    try {
      console.log(`[cf-webhook] About to issue ${oc.passes} passes for order ${order_id}`);
      console.log(`[cf-webhook] ENV KONFHUB keys:`, {
        API_KEY: !!ENV.KONFHUB_API_KEY,
        EVENT_ID: ENV.KONFHUB_EVENT_ID,
        EVENT_ID_INTERNAL: ENV.KONFHUB_EVENT_ID_INTERNAL,
        FREE_TICKET: ENV.KONFHUB_FREE_TICKET_ID,
        INTERNAL_FREE_TICKET: ENV.KONFHUB_INTERNAL_FREE_TICKET_ID,
        ACCESS_CODE_FREE: ENV.KONFHUB_ACCESS_CODE_FREE
      });
      
      issued = await issueComplimentaryPasses(ENV, oc);
      
      console.log(`[cf-webhook] Issuance succeeded:`, { total: issued.total, created: issued.created?.length, errors: issued.errors?.length });
    } catch (e) {
      oc.fulfilled = { at: new Date().toISOString(), status: 'failed', error: String(e.message || e) };
      oc.issuance_error = String(e && e.message ? e.message : e);
      await putJson(ENV, path, oc);
      console.error('[cf-webhook] Issuance FAILED:', oc.issuance_error);
      console.error('[cf-webhook] Stack:', e.stack);
      return respond(500, `Issuance failed: ${oc.issuance_error}`);
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
