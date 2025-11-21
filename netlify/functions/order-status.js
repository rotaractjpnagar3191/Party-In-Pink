const { getConfig } = require('./_config');
const { getJson } = require('./_github');

console.log('[order-status-BOOT] Module loaded');

exports.handler = async (event) => {
  const query = new URL(event.rawUrl).searchParams.get('q') || new URL(event.rawUrl).searchParams.get('id');
  console.log('[order-status] INVOKED for query:', query);
  
  if (!query) return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Missing query parameter (q or id)' }) };

  const { private: ENV } = getConfig();
  
  let order = null;
  
  // Try as order_id first
  if (query.startsWith('pip_')) {
    const path = `${ENV.STORE_PATH}/orders/${query}.json`;
    order = await getJson(ENV, path);
    console.log('[order-status] Order ID lookup:', order ? 'FOUND' : 'NOT FOUND');
  } else {
    // Try as email - scan all orders for matching email
    console.log('[order-status] Searching by email:', query);
    try {
      const listUrl = `https://api.github.com/repos/${ENV.GITHUB_OWNER}/${ENV.GITHUB_REPO}/contents/${ENV.STORE_PATH}/orders`;
      const listRes = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${ENV.GITHUB_TOKEN}`, 'Accept': 'application/vnd.github.v3+json' }
      });
      
      if (listRes.ok) {
        const files = await listRes.json();
        if (Array.isArray(files)) {
          for (const file of files) {
            if (!file.name.endsWith('.json')) continue;
            const o = await getJson(ENV, `${ENV.STORE_PATH}/orders/${file.name}`);
            if (o && o.email === query) {
              order = o;
              console.log('[order-status] Found order by email:', order.order_id);
              break;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[order-status] Email search error:', e.message);
    }
  }

  if (!order) {
    console.log('[order-status] Order not found');
    return { 
      statusCode: 404, 
      headers: { 'content-type': 'application/json' }, 
      body: JSON.stringify({ 
        ok: false,
        error: 'Order not found. Please check your Order ID or email address.'
      }) 
    };
  }

  // Redact sensitive data
  const safe = { ...order };
  if (safe.cashfree) {
    safe.cashfree = { env: order.cashfree.env };
  }
  
  return { 
    statusCode: 200, 
    headers: { 'content-type': 'application/json' }, 
    body: JSON.stringify({ 
      ok: true,
      order: safe
    }) 
  };
};
