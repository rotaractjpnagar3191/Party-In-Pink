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
      console.log('[order-status] ✓ Cashfree payments API returned: no payments (empty array)');
      return null;
    }

    // Return most recent payment
    const latest = payments[0];
    
    // CRITICAL: If payment is PENDING with no payment_time, user abandoned checkout
    if (latest.payment_status === 'PENDING' && (!latest.payment_time || latest.payment_time === null)) {
      console.log('[order-status] ✓ Cashfree returned PENDING payment with NO payment_time - treating as abandoned');
      return null;
    }
    
    console.log('[order-status] ✓ Cashfree payments API returned payment:', {
      cf_payment_id: latest.cf_payment_id,
      payment_status: latest.payment_status,
      payment_time: latest.payment_time
    });
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

  // If order not found in GitHub but we have an orderId, try Cashfree API directly
  if (!order && orderId) {
    console.log('[order-status] Order not in GitHub storage, querying Cashfree API directly');
    const cfOrder = await getCashfreeOrderStatus(orderId, ENV);
    
    if (cfOrder) {
      // ✅ Return order from Cashfree API even if not in GitHub storage
      const latestPayment = await getLatestPaymentFromCashfree(orderId, ENV);
      const orderStatus = cfOrder.order_status;
      
      console.log('[order-status] Found order in Cashfree API:', orderStatus);
      
      return {
        statusCode: 200,
        headers: {
          'content-type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
        body: JSON.stringify({
          ok: true,
          order: {
            order_id: orderId,
            order_status: orderStatus,
            latest_payment: latestPayment,
            note: 'Order data from Cashfree API (not yet in storage)'
          }
        })
      };
    }
    
    // Not found in GitHub or Cashfree
    console.log('[order-status] Order not found in GitHub or Cashfree');
    return {
      statusCode: 404,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        error: 'Order not found. Please check your Order ID or email address.'
      })
    };
  }

  if (!order && !orderId) {
    console.log('[order-status] Order not found (no orderId)');
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
    
    // If order is ACTIVE but has no payments, user may have abandoned checkout
    if (orderStatus === 'ACTIVE' && !latestPayment) {
      console.warn('[order-status] ⚠️  Order ACTIVE but NO payments - user may have abandoned checkout');
    }
  } else {
    // Fallback to cached webhook data if Cashfree API unavailable
    console.warn('[order-status] Using cached webhook data (Cashfree API unavailable)');
    const webhookData = order.cashfree?.webhook;
    
    // Only create latestPayment object if webhook has actual payment data
    if (webhookData?.payment?.cf_payment_id) {
      latestPayment = {
        cf_payment_id: webhookData?.payment?.cf_payment_id,
        payment_status: webhookData?.payment?.payment_status || 'PENDING',
        payment_time: webhookData?.payment?.payment_time,
        payment_message: webhookData?.payment?.payment_message,
        payment_completion_time: webhookData?.payment?.payment_completion_time,
        error_details: webhookData?.payment?.error_details || webhookData?.error_details
      };
      orderStatus = latestPayment?.payment_status === 'SUCCESS' ? 'PAID' : 'ACTIVE';
    } else {
      // No webhook data either - this is a pure abandoned checkout
      console.warn('[order-status] ⚠️  No webhook data AND Cashfree API unavailable - treating as abandoned checkout');
      latestPayment = null;
      orderStatus = 'ACTIVE'; // Order is active but no payment attempt
    }
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
  
  return { 
    statusCode: 200, 
    headers: { 
      'content-type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    }, 
    body: JSON.stringify({ 
      ok: true,
      order: safe
    }) 
  };
};
