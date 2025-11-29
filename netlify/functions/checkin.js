const { getJson, appendJSONL } = require('../utils/githubStore');
const { getConfig } = require('./_config');

exports.handler = async (event) => {
  if(event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const qs = event.queryStringParameters || {};
  
  // Verify admin key
  if(qs.key !== process.env.ADMIN_KEY) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized - invalid admin key' }) };
  }

  const orderId = qs.order_id;
  if(!orderId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'order_id required' }) };
  }

  try {
    const { private: ENV } = getConfig();
    
    // Fetch order from GitHub storage
    const orderPath = `${ENV.STORE_PATH}/orders/${orderId}.json`;
    const order = await getJson(ENV, orderPath);

    if (!order) {
      console.warn(`[checkin] Order not found: ${orderId}`);
      return { statusCode: 404, body: JSON.stringify({ error: 'Order not found' }) };
    }

    // ✅ VALIDATION: Ensure order has a type
    const orderType = (order.type || '').toLowerCase().trim();
    if (!['single', 'bulk', 'donation'].includes(orderType)) {
      console.warn(`[checkin] Invalid order type: ${orderType}`);
      return { statusCode: 400, body: JSON.stringify({ error: `Invalid order type: ${orderType}` }) };
    }

    // ✅ PREVENTION: Check if already checked in (double check-in prevention)
    if (order.checked_in_at) {
      console.log(`[checkin] ⚠️ Order already checked in at ${order.checked_in_at}`);
      return { statusCode: 409, body: JSON.stringify({ 
        error: 'Already checked in',
        first_checkin_at: order.checked_in_at,
        message: 'This order has already been marked as checked in'
      }) };
    }

    // Determine event based on order type
    let eventName = 'Party In Pink';

    if (orderType === 'single') {
      eventName = 'Single Registration - Party In Pink';
    } else if (orderType === 'bulk') {
      eventName = `Bulk Registration - ${order.meta?.club_name || 'Unknown Club'} - Party In Pink`;
    } else if (orderType === 'donation') {
      eventName = 'Donation - Party In Pink';
    }

    // Log check-in with full details
    const checkinRecord = {
      order_id: orderId,
      order_type: orderType,
      event_name: eventName,
      attendee_name: order.name,
      attendee_email: order.email,
      amount: order.amount,
      passes: order.passes || 1,
      checked_in_at: new Date().toISOString(),
      checked_in_by_key: 'admin_key',
      meta: {
        club_name: order.meta?.club_name || null,
        quantity: order.meta?.quantity || null,
        tier: order.meta?.tier || null
      }
    };

    // ✅ UPDATE ORDER: Mark check-in timestamp on order
    order.checked_in_at = new Date().toISOString();
    await getJson(ENV, orderPath).then(oc => {
      if (oc) {
        oc.checked_in_at = order.checked_in_at;
        const { putJson } = require('../utils/githubStore');
        return putJson(ENV, orderPath, oc);
      }
    }).catch(err => {
      console.warn(`[checkin] Could not update order with check-in time: ${err.message}`);
    });

    // Append to check-in log
    await appendJSONL('checkins.jsonl', checkinRecord);

    console.log(`[checkin] ✓ Checked in: ${orderId} (${orderType}) - ${order.name}`);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        order_id: orderId,
        order_type: orderType,
        event_name: eventName,
        attendee_name: order.name,
        attendee_email: order.email,
        passes: order.passes || 1,
        message: `✓ ${order.name} checked in for ${eventName}`
      })
    };
  } catch (err) {
    console.error('[checkin] Error:', err.message);
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Server error: ' + err.message })
    };
  }
};
