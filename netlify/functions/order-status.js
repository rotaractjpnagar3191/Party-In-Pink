const { getConfig } = require('./_config');
const { getJson } = require('./_github');

console.log('[order-status-BOOT] Module loaded');

exports.handler = async (event) => {
  const id = new URL(event.rawUrl).searchParams.get('id');
  console.log('[order-status] INVOKED for id:', id);
  
  if (!id) return { statusCode: 400, body: 'Missing id' };

  const { private: ENV } = getConfig();
  const path = `${ENV.STORE_PATH}/orders/${id}.json`;
  let oc = await getJson(ENV, path);
  
  console.log('[order-status] Lookup result:', oc ? 'FOUND' : 'NOT FOUND');
  if (oc) console.log('[order-status] Status:', oc.fulfilled?.status || 'unfulfilled');
  
  // If not in GitHub storage, return minimal status (might be reconstructed in webhook)
  if (!oc) {
    console.log('[order-status] Returning PENDING (not yet processed)');
    // Return pending status so frontend keeps polling
    // Webhook will reconstruct and update when payment is processed
    return { 
      statusCode: 200, 
      headers: { 'content-type': 'application/json' }, 
      body: JSON.stringify({ 
        order_id: id,
        status: 'pending',
        fulfilled: {
          status: 'pending'
        },
        note: 'Order being processed - webhook may reconstruct from payment data'
      }) 
    };
  }

  // Redact secrets
  const safe = { ...oc };
  delete safe.cashfree?.order?.payment_link;
  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(safe) };
};
