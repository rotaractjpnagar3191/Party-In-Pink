const { getConfig } = require('./_config');
const { getJson } = require('./_github');

console.log('[order-status-BOOT] Module loaded');

// Helper: Get order from Cashfree API (source of truth)
async function getCashfreeOrderStatus(orderId, ENV) {
  try {
    const cfEnv = (ENV.CASHFREE_ENV || 'sandbox').toLowerCase();
    const cfBase = cfEnv === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
    const apiVersion = ENV.CASHFREE_API_VERSION || '2025-01-01';

    const cfRes = await fetch(`${cfBase}/pg/orders/${orderId}`, {
      method: 'GET',
      headers: {
        'x-client-id': ENV.CASHFREE_APP_ID,
        'x-client-secret': ENV.CASHFREE_SECRET_KEY,
        'x-api-version': apiVersion,
        'content-type': 'application/json'
      }
    });

    if (!cfRes.ok) {
      console.warn(`[order-status] Cashfree API error: ${cfRes.status}`);
      return null;
    }

    const cfOrder = await cfRes.json();
    console.log('[order-status] Cashfree order status:', cfOrder.order_status);
    return cfOrder;
  } catch (err) {
    console.error('[order-status] Cashfree API call failed:', err.message);
    return null;
  }
}

// Helper: Get latest payment from Cashfree API
async function getLatestPaymentFromCashfree(orderId, ENV) {
  try {
    const cfEnv = (ENV.CASHFREE_ENV || 'sandbox').toLowerCase();
    const cfBase = cfEnv === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
    const apiVersion = ENV.CASHFREE_API_VERSION || '2025-01-01';

    // Get all payments for this order
    const paymentsRes = await fetch(`${cfBase}/pg/orders/${orderId}/payments`, {
      method: 'GET',
      headers: {
        'x-client-id': ENV.CASHFREE_APP_ID,
        'x-client-secret': ENV.CASHFREE_SECRET_KEY,
        'x-api-version': apiVersion,
        'content-type': 'application/json'
      }
    });

    if (!paymentsRes.ok) {
      console.warn(`[order-status] Cashfree payments API error: ${paymentsRes.status}`);
      return null;
    }

    const payments = await paymentsRes.json();
    if (!Array.isArray(payments) || payments.length === 0) {
      return null;
    }

    // Return most recent payment
    const latest = payments[0];
    return {
      cf_payment_id: latest.cf_payment_id,
      payment_status: latest.payment_status,
      payment_time: latest.payment_time,
      payment_message: latest.payment_message,
      payment_completion_time: latest.payment_completion_time,
      error_details: latest.error_details || null
    };
  } catch (err) {
    console.error('[order-status] Getting payments failed:', err.message);
    return null;
  }
}

exports.handler = async (event) => {
  const query = new URL(event.rawUrl).searchParams.get('q') || new URL(event.rawUrl).searchParams.get('id');
  console.log('[order-status] INVOKED for query:', query);
  
  if (!query) return { 
    statusCode: 400, 
    headers: { 'content-type': 'application/json' }, 
    body: JSON.stringify({ 
      ok: false, 
      error: 'Missing query parameter (q or id)' 
    }) 
  };

  const { private: ENV } = getConfig();
  
  let order = null;
  let orderId = null;
  
  // Try as order_id first
  if (query.startsWith('pip_')) {
    orderId = query;
    const path = `${ENV.STORE_PATH}/orders/${query}.json`;
    order = await getJson(ENV, path);
    console.log('[order-status] Order ID lookup:', order ? 'FOUND' : 'NOT FOUND');
  } else {
    // Try as email - scan all orders for matching email
    console.log('[order-status] Searching by email:', query);
    try {
      const listUrl = `https://api.github.com/repos/${ENV.GITHUB_OWNER}/${ENV.GITHUB_REPO}/contents/${ENV.STORE_PATH}/orders`;
      const listRes = await fetch(listUrl, {
        headers: { 
          Authorization: `Bearer ${ENV.GITHUB_TOKEN}`, 
          'Accept': 'application/vnd.github.v3+json' 
        }
      });
      
      if (listRes.ok) {
        const files = await listRes.json();
        if (Array.isArray(files)) {
          for (const file of files) {
            if (!file.name.endsWith('.json')) continue;
            const o = await getJson(ENV, `${ENV.STORE_PATH}/orders/${file.name}`);
            if (o && o.email === query) {
              order = o;
              orderId = o.order_id;
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

  if (!order || !orderId) {
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

  // ✅ CRITICAL FIX: Query Cashfree API for real-time status (not cached webhook)
  console.log('[order-status] Querying Cashfree API for order:', orderId);
  const cfOrder = await getCashfreeOrderStatus(orderId, ENV);
  
  let latestPayment = null;
  let orderStatus = 'UNKNOWN';
  
  if (cfOrder) {
    // Get latest payment from Cashfree
    latestPayment = await getLatestPaymentFromCashfree(orderId, ENV);
    orderStatus = cfOrder.order_status; // PAID | ACTIVE | EXPIRED | TERMINATED
    
    console.log('[order-status] Cashfree order_status:', orderStatus);
    console.log('[order-status] Payment status:', latestPayment?.payment_status);
  } else {
    // Fallback to cached webhook data if Cashfree API unavailable
    console.warn('[order-status] Using cached webhook data (Cashfree API unavailable)');
    const webhookData = order.cashfree?.webhook;
    latestPayment = {
      cf_payment_id: webhookData?.payment?.cf_payment_id,
      payment_status: webhookData?.payment?.payment_status || 'PENDING',
      payment_time: webhookData?.payment?.payment_time,
      payment_message: webhookData?.payment?.payment_message,
      payment_completion_time: webhookData?.payment?.payment_completion_time,
      error_details: webhookData?.payment?.error_details || webhookData?.error_details
    };
    orderStatus = latestPayment?.payment_status === 'SUCCESS' ? 'PAID' : 'ACTIVE';
  }

  // Payment session ID for checkout
  let payment_session_id = order.cashfree?.payment_session_id || 
                           order.cashfree?.data?.payment_session_id;

  // Redact sensitive data but keep payment status for validation
  const safe = { 
    order_id: order.order_id,
    booking_id: order.booking_id, // ✅ Include booking ID
    type: order.type,
    name: order.name,
    email: order.email,
    amount: order.amount,
    passes: order.passes,
    recipients: order.recipients,
    meta: order.meta,
    utm: order.utm, // ✅ Include marketing data
    created_at: order.created_at,
    fulfilled: order.fulfilled,
    
    // ✅ CRITICAL: Include real payment status from Cashfree
    order_status: orderStatus,
    latest_payment: latestPayment,
    
    // For checkout retry
    payment_session_id: payment_session_id,
    
    konfhub: order.konfhub ? {
      ticket_id_used: order.konfhub.ticket_id_used,
      registrations: order.konfhub.registrations,
      last_issued_at: order.konfhub.last_issued_at
    } : undefined
  };
  
  const responseBody = { 
    ok: true,
    order: safe
  };
  console.log('[order-status] RESPONDING with:', { 
    ok: responseBody.ok, 
    order_id: safe.order_id,
    fulfilled: safe.fulfilled 
  });
  
  return { 
    statusCode: 200, 
    headers: { 'content-type': 'application/json' }, 
    body: JSON.stringify(responseBody)
  };
};
