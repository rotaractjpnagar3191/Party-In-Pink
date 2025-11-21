// netlify/functions/cf-webhook.js
const crypto = require('crypto');
const { getConfig, mapAmountToPasses } = require('./_config');
const { getJson, putJson } = require('./_github');
const { issueComplimentaryPasses } = require('./_konfhub');

// CRITICAL: Log immediately on invocation
console.log('[cf-webhook-BOOT] Module loaded at', new Date().toISOString());

// In-memory cache to prevent race conditions while orders are being saved to GitHub
// Maps order_id -> { timestamp, fulfilled_status }
const issuanceCache = new Map();

exports.handler = async (event) => {
  console.log('\n\n==============================================');
  console.log('[cf-webhook] ===== WEBHOOK INVOKED =====');
  console.log('[cf-webhook] Timestamp:', new Date().toISOString());
  console.log('[cf-webhook] Method:', event?.httpMethod);
  console.log('[cf-webhook] Has event:', !!event);
  console.log('[cf-webhook] Headers:', event?.headers ? Object.keys(event.headers) : 'NO HEADERS');
  
  try {
    if (event.httpMethod !== 'POST') return respond(405, 'Method not allowed');

    const CFG = getConfig();
    const ENV = CFG.private;
    
    console.log('[cf-webhook] Config loaded, ENV keys:', Object.keys(ENV).filter(k => k.includes('KONFHUB')));

    // set ALLOW_TEST_PING=1 locally if you want to bypass signature & SUCCESS checks
    const ALLOW_TEST_PING = process.env.ALLOW_TEST_PING === '1';
    console.log('[cf-webhook] ALLOW_TEST_PING:', ALLOW_TEST_PING);

    // --- Verify Cashfree signature ---
    // Cashfree sends headers in various cases, try both
    const sig = event.headers['x-webhook-signature'] || event.headers['X-Webhook-Signature'];
    const ts  = event.headers['x-webhook-timestamp'] || event.headers['X-Webhook-Timestamp'];
    console.log('[cf-webhook] Signature present:', !!sig, 'Timestamp present:', !!ts);
    console.log('[cf-webhook] All headers:', JSON.stringify(event?.headers || {}));
    
    if (!sig || !ts) return respond(ALLOW_TEST_PING ? 200 : 400, 'Missing signature headers');

    const raw = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '');

    const SECRET = process.env.CF_WEBHOOK_SECRET || ENV.CASHFREE_SECRET_KEY;
    
    // Cashfree API v2025-01-01 & v2023-08-01: HMAC-SHA256(timestamp + rawBody)
    // Direct concatenation, NO separator
    const signatureString = ts + raw.toString('utf8');
    const expected = crypto
      .createHmac('sha256', SECRET)
      .update(signatureString)
      .digest('base64');

    console.log('[cf-webhook] Signature verification:');
    console.log('[cf-webhook] - Timestamp:', ts);
    console.log('[cf-webhook] - Raw body length:', raw.toString('utf8').length);
    console.log('[cf-webhook] - Expected signature:', expected);
    console.log('[cf-webhook] - Received signature:', sig);
    console.log('[cf-webhook] - Match:', expected === sig);
    
    if (expected !== sig) {
      console.warn('[cf-webhook] ⚠️  SIGNATURE MISMATCH');
      // Allow test pings through regardless of signature
      if (!ALLOW_TEST_PING) {
        return respond(401, 'Invalid signature');
      }
      console.warn('[cf-webhook] Continuing because ALLOW_TEST_PING=1');
    }

    // --- Parse payload ---
    const payload = JSON.parse(raw.toString('utf8'));
    const data = payload?.data || payload;

    const status   = data?.payment?.payment_status || data?.payment_status || data?.status;
    const order_id = data?.order?.order_id || data?.order_id;
    const paidAmt  = Number(data?.order?.order_amount || data?.order_amount || 0);

    console.log('[cf-webhook] Status:', status, 'OrderID:', order_id, 'Amount:', paidAmt);
    console.log('[cf-webhook] Full payload keys:', Object.keys(data || {}));
    console.log('[cf-webhook] ⚠️  FULL PAYLOAD for debugging:');
    console.log('[cf-webhook] Order ID:', data?.order?.order_id);
    console.log('[cf-webhook] Payment Status:', data?.payment?.payment_status);
    console.log('[cf-webhook] Customer Email:', data?.customer_details?.customer_email);
    console.log('[cf-webhook] Payment Time:', data?.payment?.payment_time);
    console.log('[cf-webhook] CF Payment ID:', data?.payment?.cf_payment_id);
    
    if (!order_id) return respond(ALLOW_TEST_PING ? 200 : 400, 'No order_id');
    
    // Test ping: allow any status if it's a test
    if (ALLOW_TEST_PING && !status) {
      return respond(200, 'Test ping accepted (no status required)');
    }
    
    if (status !== 'SUCCESS' && ALLOW_TEST_PING) return respond(200, 'Test ping accepted');
    if (status !== 'SUCCESS') return respond(200, 'Ignoring non-success');

    // ⚠️  EMERGENCY KILL SWITCH: Check if GitHub config is complete
    // If not configured, block all issuances to prevent duplicate tickets
    if (!ENV.GITHUB_OWNER || !ENV.GITHUB_REPO) {
      console.error('[cf-webhook] ❌ EMERGENCY KILL SWITCH ACTIVATED');
      console.error('[cf-webhook] GitHub config missing:');
      console.error('[cf-webhook] - GITHUB_OWNER:', ENV.GITHUB_OWNER || 'NOT SET');
      console.error('[cf-webhook] - GITHUB_REPO:', ENV.GITHUB_REPO || 'NOT SET');
      console.error('[cf-webhook] - GITHUB_TOKEN:', ENV.GITHUB_TOKEN ? 'SET' : 'NOT SET');
      console.error('[cf-webhook] Cannot proceed without GitHub config. Blocking ticket issuance.');
      console.error('[cf-webhook] FIX: Set GITHUB_OWNER, GITHUB_REPO in Netlify env vars and redeploy');
      return respond(500, 'BLOCKED: GitHub config incomplete - contact admin');
    }

    // --- Load stored order context ---
    const path = `${ENV.STORE_PATH}/orders/${order_id}.json`;
    
    // CHECK IN-MEMORY CACHE FIRST (prevents race conditions with rapid webhooks)
    const cacheEntry = issuanceCache.get(order_id);
    if (cacheEntry) {
      const cacheAge = Date.now() - cacheEntry.timestamp;
      if (cacheAge < 10000) { // 10 second window
        console.log(`[cf-webhook] ⚠️  ORDER IN-MEMORY CACHE HIT: ${order_id} (age: ${cacheAge}ms)`);
        console.log(`[cf-webhook] Cached fulfilled status:`, cacheEntry.fulfilled_status);
        return respond(200, `Already issued (cached, age ${cacheAge}ms)`);
      } else {
        console.log(`[cf-webhook] Cache expired for ${order_id}, clearing`);
        issuanceCache.delete(order_id);
      }
    }
    
    let oc   = await getJson(ENV, path);
    
    if (!oc) {
      console.log(`[cf-webhook] ⚠️  Order ${order_id} NOT in GitHub storage`);
      console.log(`[cf-webhook] GitHub path: ${ENV.GITHUB_OWNER}/${ENV.GITHUB_REPO}/${path}`);
    } else {
      console.log(`[cf-webhook] ✓ Order ${order_id} loaded from GitHub`);
      
      // CHECK: If order was already fulfilled, don't re-issue
      if (oc.fulfilled?.status === 'ok' || oc.fulfilled?.status === 'partial') {
        console.log('[cf-webhook] ✓ Order already fulfilled (GitHub source of truth)');
        console.log('[cf-webhook] Fulfilled at:', oc.fulfilled.at);
        console.log('[cf-webhook] RESPONDING: 200 Already fulfilled');
        return respond(200, 'Already fulfilled');
      }
      
      // CHECK: If currently processing, don't re-issue (concurrent webhook protection)
      if (oc.processing?.status === 'in_progress') {
        const processingAge = Date.now() - new Date(oc.processing.started_at).getTime();
        if (processingAge < 15000) { // 15 second processing window
          console.log(`[cf-webhook] ⚠️  Order already processing (started ${processingAge}ms ago)`);
          console.log(`[cf-webhook] Webhook will wait and retry after processing completes`);
          return respond(202, `Order is currently being processed, retry after ${15 - Math.floor(processingAge / 1000)}s`);
        } else {
          console.log(`[cf-webhook] Processing lock expired (${processingAge}ms), clearing`);
          oc.processing = null;
        }
      }
      
      // CHECK: If konfhub registrations already exist, don't re-issue
      if (oc.konfhub?.registrations?.length > 0) {
        console.log('[cf-webhook] ⚠️  KonfHub registrations already exist for this order');
        console.log('[cf-webhook] Registrations:', oc.konfhub.registrations.length, 'groups');
        console.log('[cf-webhook] RESPONDING: 200 Tickets already issued');
        return respond(200, 'Tickets already issued');
      }
    }
    
    // If order not found in storage, reconstruct from webhook payload
    if (!oc) {
      console.log(`[cf-webhook] Reconstructing order from webhook...`);
      
      // Try to extract type from order_note (format: "type|tier|quantity" or "type|club_type|quantity")
      const note = data?.order?.order_note || '';
      const noteParts = String(note).split('|');
      const noteType = noteParts[0];
      const noteMetaField = noteParts[1]; // tier or club_type
      const noteQuantity = noteParts[2];  // for bulk
      
      const inferredType = ['bulk', 'donation'].includes(String(noteType).toLowerCase()) 
        ? String(noteType).toLowerCase() 
        : 'donation';
      
      console.log(`[cf-webhook] Order note parsed: type=${noteType}, meta=${noteMetaField}, qty=${noteQuantity}`);
      
      oc = {
        order_id,
        type: inferredType,  // CRITICAL: must be 'bulk' or 'donation'
        amount: paidAmt,
        passes: noteQuantity ? parseInt(noteQuantity, 10) : 1,  // For bulk: quantity, else: 1 (recalc below)
        email: data?.customer_details?.customer_email || 'unknown@example.com',
        phone: data?.customer_details?.customer_phone || '',
        name: data?.customer_details?.customer_name || 'Guest',
        recipients: [data?.customer_details?.customer_email || 'unknown@example.com'],
        created_at: new Date().toISOString(),
        reconstructed_from_webhook: true,
        note: `Reconstructed from webhook: ${note}`,
        meta: noteType === 'bulk' ? { quantity: parseInt(noteQuantity, 10), club_type: noteMetaField } : { tier: noteMetaField }
      };
      
      console.log(`[cf-webhook] Reconstructed order:`, { type: oc.type, passes: oc.passes, meta: oc.meta });
    }

    // Prevent webhook replays: track this webhook invocation
    // If we've already processed this exact webhook, skip it
    const webhookKey = `${order_id}:${ts}:${sig}`;
    if (!oc.processed_webhooks) oc.processed_webhooks = [];
    
    console.log('[cf-webhook] ⚠️  WEBHOOK DEDUPLICATION CHECK:');
    console.log('[cf-webhook] Current webhook key:', webhookKey);
    console.log('[cf-webhook] Previously processed webhooks:', oc.processed_webhooks);
    
    if (oc.processed_webhooks.includes(webhookKey)) {
      console.log('[cf-webhook] ⚠️  DUPLICATE WEBHOOK - already processed this exact webhook');
      console.log('[cf-webhook] Webhook key:', webhookKey);
      return respond(200, 'Webhook already processed (duplicate)');
    }

    // Track this webhook
    oc.processed_webhooks = [webhookKey, ...oc.processed_webhooks.slice(0, 9)]; // keep last 10

    // Audit payload
    oc.cashfree = oc.cashfree || {};
    oc.cashfree.webhook = data;
    oc.cashfree.webhook_received_at = new Date().toISOString();

    // --- SET PROCESSING LOCK to prevent concurrent issuances ---
    // This is the critical gate that prevents multiple webhooks from issuing simultaneously
    oc.processing = {
      status: 'in_progress',
      started_at: new Date().toISOString(),
      webhook_id: webhookKey.slice(0, 20) // for tracking
    };
    
    try {
      await putJson(ENV, path, oc);
      console.log('[cf-webhook] ✓ Processing lock acquired and saved to GitHub');
    } catch (lockErr) {
      console.error('[cf-webhook] ⚠️  Failed to acquire processing lock:', lockErr.message);
      console.error('[cf-webhook] Proceeding anyway, but concurrent issuances may occur');
      // Don't abort - try to proceed
    }

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
      registrations: issued.created,
      last_issued_at: new Date().toISOString()
    };
    if (issued.errors?.length) oc.issuance_errors = issued.errors;

    oc.fulfilled = {
      at: new Date().toISOString(),
      status: issued.errors?.length ? 'partial' : 'ok',
      count: issued.total
    };

    console.log('[cf-webhook] About to save order to GitHub:');
    console.log('[cf-webhook] Path:', path);
    console.log('[cf-webhook] Order fulfilled:', oc.fulfilled);
    console.log('[cf-webhook] Processed webhooks:', oc.processed_webhooks);
    
    // SAFETY CHECK: Before saving, re-check GitHub to catch concurrent issuances
    // If another webhook already saved fulfillment, abort save to avoid duplicate data
    const latestFromGitHub = await getJson(ENV, path);
    if (latestFromGitHub?.fulfilled?.status === 'ok' || latestFromGitHub?.fulfilled?.status === 'partial') {
      console.log('[cf-webhook] ⚠️  CONCURRENT SAVE DETECTED: Another webhook already saved fulfillment');
      console.log('[cf-webhook] Order fulfilled by:', latestFromGitHub.fulfilled.at);
      console.log('[cf-webhook] Skipping save to avoid concurrent write collision');
      // Still return 200 - tickets were issued successfully by us
      return respond(200, `Issued ${oc.passes} pass(es) (concurrent issuance detected)`);
    }
    
    try {
      await putJson(ENV, path, oc);
      console.log('[cf-webhook] ✓ Order successfully saved to GitHub');
    } catch (saveErr) {
      console.error('[cf-webhook] ⚠️  SOFT FAIL - GitHub storage error (non-critical):', saveErr.message);
      console.error('[cf-webhook] ⚠️  Order was NOT persisted, but tickets WERE issued successfully');
      console.error('[cf-webhook] ⚠️  This may cause re-issuance on webhook retries, but is better than losing tickets');
      // DON'T THROW - We successfully issued tickets, just couldn't save metadata
      // Return 200 to Cashfree to prevent retries
    }
    
    // CACHE THIS ISSUANCE TO PREVENT RACE CONDITIONS
    issuanceCache.set(order_id, {
      timestamp: Date.now(),
      fulfilled_status: oc.fulfilled.status,
      passes_issued: oc.passes
    });
    console.log('[cf-webhook] ✓ Cached issuance for 10 seconds');

    // No emails from webhook — KonfHub handles attendee mails.
    // Admin notifications can be checked in the dashboard/logs.

    return respond(200, `Issued ${oc.passes} pass(es)`);
  } catch (e) {
    console.error('\n\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('[cf-webhook] ❌ OUTER CATCH - UNEXPECTED ERROR');
    console.error('[cf-webhook] Error:', e?.message || String(e));
    console.error('[cf-webhook] Stack:', e?.stack);
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    return respond(500, `OUTER CATCH: ${e?.message || String(e)}`);
  }
};

const respond = (statusCode, body) => {
  const response = {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-cache'
    },
    body: typeof body === 'string' ? JSON.stringify({ message: body }) : JSON.stringify(body)
  };
  console.log('[cf-webhook] RESPONDING:', statusCode, body);
  return response;
};
