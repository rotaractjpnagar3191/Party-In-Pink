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

// Webhook deduplication registry in memory (survives Lambda execution context reuse)
// Maps webhookKey -> timestamp (last seen)
const webhookRegistry = new Map();

exports.handler = async (event) => {
  console.log('\n\n==============================================');
  console.log('[cf-webhook] ===== WEBHOOK INVOKED =====');
  console.log('[cf-webhook] Timestamp:', new Date().toISOString());
  console.log('[cf-webhook] Method:', event?.httpMethod);
  console.log('[cf-webhook] Has event:', !!event);
  console.log('[cf-webhook] Headers:', event?.headers ? Object.keys(event.headers) : 'NO HEADERS');
  console.log('[cf-webhook] Event body length:', event?.body?.length || 0);
  console.log('[cf-webhook] Event isBase64Encoded:', event?.isBase64Encoded);
  
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
      console.warn('[cf-webhook] Expected:', expected);
      console.warn('[cf-webhook] Received:', sig);
      console.warn('[cf-webhook] Secret key set:', !!SECRET);
      console.warn('[cf-webhook] Secret key length:', String(SECRET).length);
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
    
    // ⚠️  CRITICAL: PAYMENT MUST BE SUCCESSFUL TO PROCEED
    // If status is not SUCCESS, log and reject WITHOUT issuing tickets
    if (status !== 'SUCCESS') {
      console.log(`[cf-webhook] ⚠️  PAYMENT FAILED OR PENDING: status=${status}`);
      console.log(`[cf-webhook] order_id=${order_id}, amount=${paidAmt}`);
      console.log('[cf-webhook] NOT issuing tickets for non-successful payment');
      console.log('[cf-webhook] Returning 200 to prevent Cashfree retries');
      return respond(200, `Payment not successful (status=${status}), no tickets issued`);
    }

    // --- VERIFY PAYMENT with Cashfree API ---
    // Double-check with Cashfree's /orders/:order_id/payments endpoint
    // This adds extra security against webhook spoofing/replay attacks
    console.log('[cf-webhook] Verifying payment with Cashfree API...');
    const paymentVerified = await verifyPaymentWithCashfree(ENV, order_id, paidAmt, data?.payment?.cf_payment_id);
    
    if (!paymentVerified.verified) {
      console.error(`[cf-webhook] ❌ PAYMENT VERIFICATION FAILED:`, paymentVerified.reason);
      // Do NOT issue tickets if verification fails
      // Return 200 to stop Cashfree retries, but mark order as failed
      oc = oc || { order_id, type: 'unknown', created_at: new Date().toISOString() };
      oc.fulfilled = {
        at: new Date().toISOString(),
        status: 'failed',
        error: `Payment verification failed: ${paymentVerified.reason}`
      };
      if (ENV.GITHUB_TOKEN) {
        try {
          await putJson(ENV, `${ENV.STORE_PATH}/orders/${order_id}.json`, oc);
        } catch (e) {
          console.error('[cf-webhook] Failed to save verification failure:', e.message);
        }
      }
      return respond(200, `Payment verification failed: ${paymentVerified.reason}`);
    }
    
    console.log('[cf-webhook] ✓ Payment verified successfully');
    console.log('[cf-webhook] Verified details:', {
      order_id: paymentVerified.order_id,
      amount_verified: paymentVerified.amount,
      payment_status: paymentVerified.payment_status,
      settlement_status: paymentVerified.settlement_status
    });

    // --- WEBHOOK DEDUPLICATION CHECK (immediate, before any processing) ---
    // Build unique webhook key from timestamp + signature (Cashfree's unique identifier for this webhook)
    const webhookKey = `${order_id}:${ts}:${sig}`;
    const lastSeen = webhookRegistry.get(webhookKey);
    if (lastSeen) {
      const timeSince = Date.now() - lastSeen;
      console.log(`[cf-webhook] ⚠️  DUPLICATE WEBHOOK DETECTED: ${webhookKey}`);
      console.log(`[cf-webhook] Last processed ${timeSince}ms ago`);
      console.log(`[cf-webhook] RESPONDING: 200 Duplicate webhook (already processed)`);
      return respond(200, `Duplicate webhook (last seen ${timeSince}ms ago)`);
    }
    
    // Register this webhook as seen (will survive Lambda execution context)
    webhookRegistry.set(webhookKey, Date.now());
    console.log(`[cf-webhook] ✓ Webhook registered: ${webhookKey.slice(0, 30)}...`);

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
      console.log(`[cf-webhook] ⚠️  Order ${order_id} NOT created yet in system`);
      console.log(`[cf-webhook] This webhook may have arrived before create-order.js completed`);
      console.log(`[cf-webhook] Reconstructing order from webhook...`);
      
      // Try to extract type from order_note (format: "type|tier/club_type|quantity")
      const note = data?.order?.order_note || '';
      const noteParts = String(note).split('|');
      const noteType = noteParts[0];
      const noteTierOrClub = noteParts[1] || '';
      const noteQuantity = parseInt(noteParts[2] || '0', 10) || 0;
      
      console.log('[cf-webhook] 🔍 RECONSTRUCTION DETAILS:');
      console.log('[cf-webhook]   - order_note:', note);
      console.log('[cf-webhook]   - noteParts:', noteParts);
      console.log('[cf-webhook]   - noteType:', noteType);
      console.log('[cf-webhook]   - noteTierOrClub:', noteTierOrClub);
      console.log('[cf-webhook]   - noteQuantity:', noteQuantity);
      
      // ⚠️  VALIDATION: Can only reconstruct if we have minimum info
      if (!noteType || !['bulk', 'donation'].includes(noteType)) {
        console.error('[cf-webhook] ❌ Cannot reconstruct order: missing or invalid type in order_note');
        console.error('[cf-webhook] order_note:', note);
        console.error('[cf-webhook] This order will be skipped');
        return respond(200, 'Order reconstruction failed: missing type in order_note');
      }
      
      oc = {
        order_id,
        type: noteType,
        name: data?.customer_details?.customer_name || 'Unknown',
        email: data?.customer_details?.customer_email || 'unknown@example.com',
        phone: data?.customer_details?.customer_phone || '',
        amount: paidAmt,
        passes: noteType === 'bulk' ? noteQuantity : 0, // Extract quantity from order_note for bulk orders
        recipients: [data?.customer_details?.customer_email || 'unknown@example.com'],
        meta: noteType === 'bulk' 
          ? { 
              club_type: noteTierOrClub || 'COMMUNITY',
              quantity: noteQuantity 
            }
          : { tier: noteTierOrClub || 'WEBHOOK_RECONSTRUCTED' },
        created_at: new Date().toISOString(),
        cashfree: { env: (ENV.CASHFREE_ENV || 'sandbox').toLowerCase(), order: data?.order || {} },
      };
      
      console.log(`[cf-webhook] ✓ Reconstructed order:`, { 
        type: oc.type, 
        passes: oc.passes, 
        recipients: oc.recipients, 
        meta: oc.meta,
        amount: oc.amount
      });
    }

    // Prevent webhook replays: track this webhook invocation
    // If we've already processed this exact webhook, skip it
    const webhookKeyForReplay = `${order_id}:${ts}:${sig}`;
    if (!oc.processed_webhooks) oc.processed_webhooks = [];
    
    console.log('[cf-webhook] ⚠️  WEBHOOK DEDUPLICATION CHECK:');
    console.log('[cf-webhook] Current webhook key:', webhookKeyForReplay);
    console.log('[cf-webhook] Previously processed webhooks:', oc.processed_webhooks);
    
    if (oc.processed_webhooks.includes(webhookKeyForReplay)) {
      console.log('[cf-webhook] ⚠️  DUPLICATE WEBHOOK - already processed this exact webhook');
      console.log('[cf-webhook] Webhook key:', webhookKeyForReplay);
      return respond(200, 'Webhook already processed (duplicate)');
    }

    // Track this webhook
    oc.processed_webhooks = [webhookKeyForReplay, ...oc.processed_webhooks.slice(0, 9)]; // keep last 10

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

    // Compute passes/amount (server as source of truth)
    if (oc.type === "bulk") {
      oc.passes = Number(oc.meta?.quantity || oc.passes || 0);
      console.log('[cf-webhook] 🔍 BULK ORDER - Computing passes:');
      console.log('[cf-webhook]   - oc.meta.quantity:', oc.meta?.quantity);
      console.log('[cf-webhook]   - oc.passes (before):', Number(oc.passes));
      console.log('[cf-webhook]   - Result:', oc.passes);
      // amount usually pre-set during create-order; keep as-is
    } else {
      oc.amount = paidAmt;
      console.log('[cf-webhook] 🔍 DONATION ORDER - Computing passes:');
      console.log('[cf-webhook]   - paidAmt:', paidAmt);
      console.log('[cf-webhook]   - CFG.public.SLABS:', CFG.public.SLABS);
      // Below-minimum now grants 1 complimentary pass
      oc.passes = mapAmountToPasses(
        paidAmt,
        CFG.public.SLABS,
        1,
        ENV.SLAB_ABOVE_MAX
      );
      console.log('[cf-webhook]   - Computed passes:', oc.passes);
    }
    
    console.log('[cf-webhook] Computed passes:', oc.passes, 'Type:', oc.type, 'Amount:', oc.amount);
    console.log('[cf-webhook] Recipient emails:', oc.recipients);

    // ⚠️  VALIDATION: Must have passes > 0 to issue tickets
    console.log('[cf-webhook] 🔍 VALIDATION CHECK - Passes:');
    console.log('[cf-webhook]   - oc.passes:', oc.passes);
    console.log('[cf-webhook]   - oc.meta?.quantity:', oc.meta?.quantity);
    console.log('[cf-webhook]   - oc.type:', oc.type);
    console.log('[cf-webhook]   - oc.amount:', oc.amount);
    
    if (!oc.passes || Number(oc.passes) <= 0) {
      console.error(`[cf-webhook] ❌ VALIDATION FAILED: passes must be > 0`);
      console.error(`[cf-webhook] Computed passes: ${oc.passes}, Type: ${oc.type}, Amount: ${oc.amount}`);
      oc.fulfilled = { at: new Date().toISOString(), status: 'failed', error: 'Invalid passes count' };
      await putJson(ENV, path, oc);
      return respond(400, `Invalid order: passes must be > 0 (got ${oc.passes})`);
    }

    // ⚠️  VALIDATION: Must have recipients to issue tickets
    console.log('[cf-webhook] 🔍 VALIDATION CHECK - Recipients:');
    console.log('[cf-webhook]   - oc.recipients:', oc.recipients);
    console.log('[cf-webhook]   - Length:', oc.recipients?.length);
    console.log('[cf-webhook]   - Email:', oc.email);
    
    if (!oc.recipients || oc.recipients.length === 0) {
      console.error(`[cf-webhook] ❌ VALIDATION FAILED: no recipients`);
      console.error(`[cf-webhook] Full order object:`, oc);
      oc.fulfilled = { at: new Date().toISOString(), status: 'failed', error: 'No recipients' };
      await putJson(ENV, path, oc);
      return respond(400, 'Invalid order: no recipients');
    }

    // --- Issue via KonfHub (KonfHub sends attendee emails) ---
    let issued;
    try {
      console.log(`[cf-webhook] ===== ABOUT TO CALL KONFHUB =====`);
      console.log(`[cf-webhook] Order ID: ${order_id}`);
      console.log(`[cf-webhook] Type: ${oc.type}`);
      console.log(`[cf-webhook] Passes: ${oc.passes}`);
      console.log(`[cf-webhook] Recipients: ${JSON.stringify(oc.recipients)}`);
      console.log(`[cf-webhook] Email: ${oc.email}`);
      console.log(`[cf-webhook] Name: ${oc.name}`);
      console.log(`[cf-webhook] Phone: ${oc.phone}`);
      console.log(`[cf-webhook] Meta: ${JSON.stringify(oc.meta)}`);
      console.log('[cf-webhook] ENV KONFHUB keys:');
      console.log('[cf-webhook]   - API_KEY:', !!ENV.KONFHUB_API_KEY);
      console.log('[cf-webhook]   - EVENT_ID:', ENV.KONFHUB_EVENT_ID);
      console.log('[cf-webhook]   - EVENT_ID_INTERNAL:', ENV.KONFHUB_EVENT_ID_INTERNAL);
      console.log('[cf-webhook]   - BULK_TICKET_ID:', ENV.KONFHUB_BULK_TICKET_ID);
      console.log('[cf-webhook]   - INTERNAL_BULK_TICKET_ID:', ENV.KONFHUB_INTERNAL_BULK_TICKET_ID);
      console.log('[cf-webhook]   - FREE_TICKET_ID:', ENV.KONFHUB_FREE_TICKET_ID);
      console.log('[cf-webhook]   - INTERNAL_FREE_TICKET_ID:', ENV.KONFHUB_INTERNAL_FREE_TICKET_ID);
      console.log('[cf-webhook]   - ACCESS_CODE_BULK:', ENV.KONFHUB_ACCESS_CODE_BULK);
      console.log('[cf-webhook]   - ACCESS_CODE_FREE:', ENV.KONFHUB_ACCESS_CODE_FREE);
      
      issued = await issueComplimentaryPasses(ENV, oc);
      
      console.log(`[cf-webhook] ✓ KonfHub issuance succeeded:`);
      console.log('[cf-webhook]   - Total:', issued.total);
      console.log('[cf-webhook]   - Created groups:', issued.created?.length);
      console.log('[cf-webhook]   - Errors:', issued.errors?.length);
      console.log('[cf-webhook]   - Tickets used:', issued.tickets_used);
      if (issued.created?.length > 0) {
        console.log('[cf-webhook]   - First created group:', issued.created[0]);
      }
    } catch (e) {
      oc.fulfilled = { at: new Date().toISOString(), status: 'failed', error: String(e.message || e) };
      oc.issuance_error = String(e && e.message ? e.message : e);
      await putJson(ENV, path, oc);
      console.error('[cf-webhook] ❌ KonfHub issuance FAILED:');
      console.error('[cf-webhook]   - Error message:', oc.issuance_error);
      console.error('[cf-webhook]   - Full error:', e);
      console.error('[cf-webhook]   - Stack:', e.stack);
      console.error('[cf-webhook]   - Order at failure:', oc);
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

    // Clear processing lock now that we're done
    oc.processing = null;

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

// ========== PAYMENT VERIFICATION WITH CASHFREE API ==========
// Verify payment by querying Cashfree's API directly
// This prevents webhook spoofing and ensures payment was actually received
async function verifyPaymentWithCashfree(ENV, order_id, expectedAmount, cf_payment_id) {
  try {
    const cfEnv = (ENV.CASHFREE_ENV || 'sandbox').toLowerCase();
    const cfBase = cfEnv === 'production' 
      ? 'https://api.cashfree.com' 
      : 'https://sandbox.cashfree.com';
    
    const apiVersion = ENV.CASHFREE_API_VERSION && /^\d{4}-\d{2}-\d{2}$/.test(ENV.CASHFREE_API_VERSION)
      ? ENV.CASHFREE_API_VERSION
      : '2025-01-01';

    console.log('[verify-payment] Querying Cashfree API:', { order_id, cfBase, apiVersion });

    // Create AbortController with 10s timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 10000);

    let response;
    try {
      response = await fetch(`${cfBase}/pg/orders/${order_id}`, {
        method: 'GET',
        headers: {
          'x-client-id': ENV.CASHFREE_APP_ID,
          'x-client-secret': ENV.CASHFREE_SECRET_KEY,
          'x-api-version': apiVersion,
          'content-type': 'application/json',
        },
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      console.error('[verify-payment] API error:', response.status, response.statusText);
      return {
        verified: false,
        reason: `API error: ${response.status}`
      };
    }

    const orderData = await response.json();
    console.log('[verify-payment] Cashfree order data received');
    console.log('[verify-payment] Order:', {
      order_id: orderData.order_id,
      order_amount: orderData.order_amount,
      order_status: orderData.order_status
    });

    // ⚠️  VALIDATION CHECKS
    
    // 1. Check order exists and matches
    if (orderData.order_id !== order_id) {
      console.error('[verify-payment] Order ID mismatch:', orderData.order_id, '!==', order_id);
      return {
        verified: false,
        reason: 'Order ID mismatch'
      };
    }

    // 2. Check amount matches (within 1 paisa tolerance for rounding)
    const amountDiff = Math.abs(Number(orderData.order_amount || 0) - expectedAmount);
    if (amountDiff > 0.01) {
      console.error('[verify-payment] Amount mismatch:', orderData.order_amount, '!==', expectedAmount);
      return {
        verified: false,
        reason: `Amount mismatch: expected ₹${expectedAmount}, got ₹${orderData.order_amount}`
      };
    }

    // 3. Check if order has successful payments
    if (!orderData.payments || orderData.payments.length === 0) {
      console.error('[verify-payment] No payments found for order');
      return {
        verified: false,
        reason: 'No payments recorded for this order'
      };
    }

    // 4. Find a successful payment
    const successfulPayment = orderData.payments.find(p => 
      p.payment_status === 'SUCCESS' || p.payment_status === 'success'
    );

    if (!successfulPayment) {
      console.error('[verify-payment] No successful payment found');
      console.log('[verify-payment] Payments:', orderData.payments.map(p => ({
        payment_id: p.cf_payment_id,
        status: p.payment_status,
        amount: p.payment_amount
      })));
      return {
        verified: false,
        reason: 'No successful payment found'
      };
    }

    console.log('[verify-payment] ✓ Successful payment found:', {
      cf_payment_id: successfulPayment.cf_payment_id,
      payment_amount: successfulPayment.payment_amount,
      payment_time: successfulPayment.payment_time,
      payment_method: successfulPayment.payment_method,
      utr: successfulPayment.utr || 'N/A'
    });

    // 5. Verify the payment amount matches order amount
    const paymentAmountDiff = Math.abs(Number(successfulPayment.payment_amount || 0) - expectedAmount);
    if (paymentAmountDiff > 0.01) {
      console.error('[verify-payment] Payment amount mismatch:', successfulPayment.payment_amount, '!==', expectedAmount);
      return {
        verified: false,
        reason: `Payment amount mismatch: expected ₹${expectedAmount}, got ₹${successfulPayment.payment_amount}`
      };
    }

    // 6. All checks passed - payment is verified
    console.log('[verify-payment] ✅ PAYMENT VERIFIED');
    return {
      verified: true,
      order_id: orderData.order_id,
      amount: orderData.order_amount,
      payment_status: orderData.order_status,
      settlement_status: orderData.settlement_status,
      payment_method: successfulPayment.payment_method,
      payment_time: successfulPayment.payment_time,
      cf_payment_id: successfulPayment.cf_payment_id
    };

  } catch (err) {
    console.error('[verify-payment] Verification error:', err?.message);
    console.error('[verify-payment] Stack:', err?.stack);
    
    if (err.name === 'AbortError') {
      return {
        verified: false,
        reason: 'Verification request timeout'
      };
    }

    return {
      verified: false,
      reason: err?.message || 'Verification failed'
    };
  }
}
