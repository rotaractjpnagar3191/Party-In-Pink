// DEBUG ENDPOINT - Show raw order data from GitHub
const { getConfig } = require('./_config');
const { getJson } = require('./_github');

exports.handler = async (event) => {
  const query = new URL(event.rawUrl).searchParams.get('id');
  
  if (!query) return {
    statusCode: 400,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ error: 'Missing id parameter' })
  };

  try {
    const { private: ENV } = getConfig();
    const path = `${ENV.STORE_PATH}/orders/${query}.json`;
    
    console.log('[debug-order] Fetching:', path);
    const order = await getJson(ENV, path);
    
    if (!order) {
      return {
        statusCode: 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          error: 'Order not found',
          path,
          id: query,
          timestamp: new Date().toISOString()
        })
      };
    }

    // Log every field
    console.log('[debug-order] Full order object:');
    console.log('[debug-order] - order_id:', order.order_id);
    console.log('[debug-order] - type:', order.type);
    console.log('[debug-order] - passes:', order.passes);
    console.log('[debug-order] - fulfilled:', order.fulfilled);
    console.log('[debug-order] - konfhub:', order.konfhub);
    console.log('[debug-order] - processing:', order.processing);
    console.log('[debug-order] - issuance_error:', order.issuance_error);
    console.log('[debug-order] - created_at:', order.created_at);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        order,
        debug: {
          has_fulfilled: !!order.fulfilled,
          fulfilled_status: order.fulfilled?.status,
          has_konfhub: !!order.konfhub,
          has_error: !!order.issuance_error,
          error_message: order.issuance_error,
          processing_status: order.processing?.status,
          recipients: order.recipients,
          passes: order.passes
        }
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        error: e.message,
        stack: e.stack
      })
    };
  }
};
