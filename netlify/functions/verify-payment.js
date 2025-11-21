// netlify/functions/verify-payment.js
// Verify payment status for an order (called before issuing tickets on frontend)
const { getConfig } = require('./_config');

const json = (s, b) => ({
  statusCode: s,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(b),
});

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
      return json(405, { error: 'Method not allowed' });
    }

    const qs = event.queryStringParameters || {};
    const body = event.httpMethod === 'POST' ? JSON.parse(event.body || '{}') : {};
    
    const order_id = (qs.order_id || qs.id || body.order_id || body.id || '').trim();
    
    if (!order_id) {
      return json(400, { error: 'Missing order_id' });
    }

    const CFG = getConfig();
    const ENV = CFG.private;

    if (!ENV.CASHFREE_APP_ID || !ENV.CASHFREE_SECRET_KEY) {
      return json(500, { error: 'Cashfree not configured' });
    }

    const cfEnv = (ENV.CASHFREE_ENV || 'sandbox').toLowerCase();
    const cfBase = cfEnv === 'production' 
      ? 'https://api.cashfree.com' 
      : 'https://sandbox.cashfree.com';
    
    const apiVersion = ENV.CASHFREE_API_VERSION && /^\d{4}-\d{2}-\d{2}$/.test(ENV.CASHFREE_API_VERSION)
      ? ENV.CASHFREE_API_VERSION
      : '2025-01-01';

    console.log('[verify-payment-api] Checking payment status for:', order_id);

    // Query Cashfree API
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
      console.log('[verify-payment-api] API error:', response.status);
      return json(response.status, { 
        error: 'Could not verify payment',
        status_code: response.status 
      });
    }

    const orderData = await response.json();
    console.log('[verify-payment-api] Order status:', orderData.order_status);

    // Extract payment status
    const successfulPayment = orderData.payments?.find(p => 
      p.payment_status === 'SUCCESS' || p.payment_status === 'success'
    );

    return json(200, {
      ok: true,
      order_id: orderData.order_id,
      order_status: orderData.order_status,
      order_amount: orderData.order_amount,
      has_successful_payment: !!successfulPayment,
      payment_details: successfulPayment ? {
        cf_payment_id: successfulPayment.cf_payment_id,
        payment_method: successfulPayment.payment_method,
        payment_time: successfulPayment.payment_time,
        settlement_status: successfulPayment.settlement_status,
      } : null,
      payments_count: orderData.payments?.length || 0,
      settlement_status: orderData.settlement_status,
      created_at: orderData.created_at,
      updated_at: orderData.updated_at,
    });

  } catch (err) {
    console.error('[verify-payment-api] Error:', err?.message);
    return json(500, { 
      error: err?.message || 'Server error',
      order_id: (event.queryStringParameters?.order_id || JSON.parse(event.body || '{}').order_id || '')
    });
  }
};
