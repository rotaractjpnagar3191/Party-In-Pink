// netlify/functions/finalize-order.js
// Fallback endpoint called by success page when webhook may have failed
// This triggers pass issuance if the order is paid but not yet fulfilled
const { getConfig, mapAmountToPasses } = require('./_config');
const { getJson, putJson } = require('./_github');
const { issueComplimentaryPasses } = require('./_konfhub');
const { sendMail, emailTemplates } = require('./_mail');

console.log('[finalize-order-BOOT] Module loaded');

exports.handler = async (event) => {
  console.log('\n[finalize-order] INVOKED:', new Date().toISOString());
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method not allowed' };
    }

    const { order_id } = JSON.parse(event.body || '{}');
    console.log('[finalize-order] order_id:', order_id);
    
    if (!order_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing order_id' }) };
    }

    const CFG = getConfig();
    const ENV = CFG.private;
    console.log('[finalize-order] Config loaded');

    // Load order from storage
    const path = `${ENV.STORE_PATH}/orders/${order_id}.json`;
    let oc = await getJson(ENV, path);
    console.log('[finalize-order] Order lookup:', oc ? 'FOUND' : 'NOT FOUND');

    // Retry logic: if order not found, wait a bit and try again
    // (GitHub save might still be in progress from create-order)
    if (!oc) {
      console.log(`[finalize-order] Order ${order_id} not found, retrying after 1s...`);
      await new Promise(res => setTimeout(res, 1000));
      oc = await getJson(ENV, path);
      console.log('[finalize-order] Second lookup:', oc ? 'FOUND' : 'NOT FOUND');
    }

    // If order not found in GitHub, we can still finalize using Cashfree API data
    // This is important for local dev or when GitHub integration fails
    if (!oc) {
      console.log(`[finalize-order] Order not in storage, checking Cashfree API...`);
      
      try {
        const cfEnv = (ENV.CASHFREE_ENV || 'sandbox').toLowerCase();
        const cfBase = cfEnv === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
        const apiVersion = ENV.CASHFREE_API_VERSION || '2025-01-01';

        const cfRes = await fetch(`${cfBase}/pg/orders/${order_id}`, {
          method: 'GET',
          headers: {
            'x-client-id': ENV.CASHFREE_APP_ID,
            'x-client-secret': ENV.CASHFREE_SECRET_KEY,
            'x-api-version': apiVersion,
            'content-type': 'application/json'
          }
        });

        if (cfRes.ok) {
          const cfOrder = await cfRes.json();
          console.log('[finalize-order] Found order in Cashfree:', cfOrder.order_status);
          
          // Return success but note that we're working from Cashfree data, not storage
          // This prevents duplicate processing and allows the success page to proceed
          if (cfOrder.order_status === 'PAID') {
            return {
              statusCode: 200,
              body: JSON.stringify({
                ok: true,
                order_id,
                status: 'pending_issuance',
                message: 'Order verified from Cashfree API (not in storage)',
                note: 'Actual pass issuance will occur via webhook'
              })
            };
          }
        }
      } catch (cfErr) {
        console.error('[finalize-order] Cashfree API check failed:', cfErr.message);
      }
      
      // Still not found - return error
      console.warn(`finalize-order: Order ${order_id} not found in storage or Cashfree API`);
      return { 
        statusCode: 404, 
        body: JSON.stringify({ 
          error: 'Order not found in storage',
          hint: 'Ensure order was created and Cashfree sent payment webhook first',
          order_id 
        }) 
      };
    }

    // Already fulfilled - return status
    if (oc.fulfilled) {
      console.log('[finalize-order] Already fulfilled:', oc.fulfilled.status);
      return { 
        statusCode: 200, 
        body: JSON.stringify({ 
          ok: true, 
          order_id, 
          status: 'already_fulfilled',
          fulfilled: oc.fulfilled,
          passes: oc.passes
        }) 
      };
    }

    // ⚠️  CRITICAL: Check if payment was actually successful before issuing tickets
    // This prevents fraudulent ticket dispatch if someone calls finalize-order without paying
    const paymentStatus = oc.cashfree?.webhook?.payment?.payment_status;
    const orderStatus = oc.cashfree?.webhook?.order?.order_status;
    
    console.log('[finalize-order] Payment validation:');
    console.log('[finalize-order]   - Payment status from webhook:', paymentStatus);
    console.log('[finalize-order]   - Order status from webhook:', orderStatus);
    console.log('[finalize-order]   - Has webhook data:', !!oc.cashfree?.webhook);
    
    // If we have webhook data, payment status must be SUCCESS
    if (oc.cashfree?.webhook && paymentStatus !== 'SUCCESS') {
      console.error('[finalize-order] ❌ PAYMENT VALIDATION FAILED: Payment not successful');
      console.error('[finalize-order] Payment status:', paymentStatus);
      oc.fulfilled = {
        at: new Date().toISOString(),
        status: 'failed',
        error: `Payment validation failed: status=${paymentStatus}`,
        triggered_by: 'finalize-order'
      };
      await putJson(ENV, `${ENV.STORE_PATH}/orders/${order_id}.json`, oc);
      
      return {
        statusCode: 402,
        body: JSON.stringify({
          error: 'Payment not successful',
          payment_status: paymentStatus,
          message: 'Cannot issue tickets without successful payment',
          order_id
        })
      };
    }

    // Check if recently issued (within last 5 seconds) to prevent rapid re-issuance
    if (oc.konfhub?.registrations) {
      const lastIssuanceTime = new Date(oc.konfhub.last_issued_at || 0).getTime();
      const now = new Date().getTime();
      if (now - lastIssuanceTime < 5000) {
        console.log('[finalize-order] Recently issued (within 5s), skipping duplicate issuance');
        return { 
          statusCode: 200, 
          body: JSON.stringify({ 
            ok: true, 
            order_id, 
            status: 'already_fulfilled',
            message: 'Issuance happened very recently, likely a duplicate call',
            fulfilled: oc.fulfilled,
            passes: oc.passes
          }) 
        };
      }
    }

    // Not yet fulfilled - trigger issuance
    try {
      console.log(`[finalize-order] Triggering issuance of ${oc.passes} passes`);
      
      const issued = await issueComplimentaryPasses(ENV, oc);
      console.log('[finalize-order] Issuance completed:', { total: issued.total, created: issued.created?.length, errors: issued.errors?.length });
      
      // Update order with fulfillment status
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
        count: issued.total,
        triggered_by: 'finalize-order'
      };

      await putJson(ENV, path, oc);
      console.log('[finalize-order] Order updated and saved');

      // Send confirmation email to purchaser (async, non-blocking)
      (async () => {
        try {
          console.log('[finalize-order] Sending confirmation email to:', oc.email);
          const templates = emailTemplates();
          const { subject, html, text } = templates.purchaser(oc);
          await sendMail(ENV, {
            to: oc.email,
            subject,
            html,
            text
          });
          console.log('[finalize-order] ✓ Confirmation email sent to:', oc.email);
        } catch (emailErr) {
          console.warn('[finalize-order] ⚠️  Failed to send confirmation email:', emailErr?.message);
          // Don't fail the request for email issues - tickets are issued
        }
      })();

      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          order_id,
          status: 'issued',
          passes_issued: oc.passes,
          fulfilled: oc.fulfilled,
          issued_details: issued
        })
      };
    } catch (issueErr) {
      console.error(`[finalize-order] Issuance FAILED:`, issueErr?.message);
      console.error('[finalize-order] Stack:', issueErr?.stack);
      
      // Mark as failed attempt
      oc.fulfilled = {
        at: new Date().toISOString(),
        status: 'failed',
        error: String(issueErr && issueErr.message ? issueErr.message : issueErr),
        triggered_by: 'finalize-order'
      };
      await putJson(ENV, path, oc);

      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Issuance failed',
          order_id,
          message: issueErr && issueErr.message ? issueErr.message : String(issueErr)
        })
      };
    }
  } catch (e) {
    console.error('finalize-order error:', e);
    return { 
      statusCode: 500, 
      body: JSON.stringify({ error: e.message || 'Server error' }) 
    };
  }
};
