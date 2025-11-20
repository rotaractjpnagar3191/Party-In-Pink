// Diagnostic endpoint to test the entire pass issuance flow

const { getConfig } = require('./_config');
const { getJson } = require('./_github');
const { issueComplimentaryPasses } = require('./_konfhub');

exports.handler = async (event) => {
  try {
    console.log('[diagnostic] Started');
    
    const { order_id } = JSON.parse(event.body || '{}');
    if (!order_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing order_id' }) };
    }

    const CFG = getConfig();
    const ENV = CFG.private;

    console.log('[diagnostic] Loading order:', order_id);
    const path = `${ENV.STORE_PATH}/orders/${order_id}.json`;
    const oc = await getJson(ENV, path);

    if (!oc) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Order not found', path }) };
    }

    console.log('[diagnostic] Order found:', { type: oc.type, passes: oc.passes, email: oc.email });

    console.log('[diagnostic] Checking KonfHub config:');
    console.log('  - API_KEY:', !!ENV.KONFHUB_API_KEY);
    console.log('  - EVENT_ID_INTERNAL:', ENV.KONFHUB_EVENT_ID_INTERNAL);
    console.log('  - INTERNAL_FREE_TICKET_ID:', ENV.KONFHUB_INTERNAL_FREE_TICKET_ID);
    console.log('  - ACCESS_CODE_FREE:', ENV.KONFHUB_ACCESS_CODE_FREE);

    console.log('[diagnostic] Attempting issuance...');
    const result = await issueComplimentaryPasses(ENV, oc);

    console.log('[diagnostic] Success! Result:', result);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        order_id,
        result
      })
    };
  } catch (err) {
    console.error('[diagnostic] ERROR:', err.message, err.stack);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: err.message,
        stack: err.stack
      })
    };
  }
};
