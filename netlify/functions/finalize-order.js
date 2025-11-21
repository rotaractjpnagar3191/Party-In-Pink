// netlify/functions/finalize-order.js
// Fallback endpoint called by success page when webhook may have failed
// This triggers pass issuance if the order is paid but not yet fulfilled
const { getConfig, mapAmountToPasses } = require('./_config');
const { getJson, putJson } = require('./_github');
const { issueComplimentaryPasses } = require('./_konfhub');

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

    // If order not found, return helpful error (caller should have data)
    if (!oc) {
      console.warn(`finalize-order: Order ${order_id} not found in storage`);
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
        registrations: issued.created
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
