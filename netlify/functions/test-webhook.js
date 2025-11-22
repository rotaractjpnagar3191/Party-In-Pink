// Test webhook endpoint - can be called to simulate payment
const crypto = require('crypto');
const { getConfig, mapAmountToPasses } = require('./_config');
const { putJson } = require('./_github');
const { issueComplimentaryPasses } = require('./_konfhub');

exports.handler = async (event) => {
  console.log('\n\n============ TEST WEBHOOK HANDLER ============');
  
  // Only allow POST
  if (event.httpMethod !== 'POST') return respond(405, 'Method not allowed');

  // Get order ID from query
  const qs = new URL(event.rawUrl).searchParams;
  const testOrderId = qs.get('order_id');
  const testStatus = qs.get('status') || 'SUCCESS';
  const testAmount = qs.get('amount') || '2388';

  console.log('[test-webhook] Parameters:');
  console.log('[test-webhook]   - order_id:', testOrderId);
  console.log('[test-webhook]   - status:', testStatus);
  console.log('[test-webhook]   - amount:', testAmount);

  if (!testOrderId) {
    return respond(400, 'Missing order_id parameter. Usage: /api/test-webhook?order_id=pip_xxx&status=SUCCESS&amount=2388');
  }

  try {
    const CFG = getConfig();
    const ENV = CFG.private;

    // Simulate webhook payload
    const payload = {
      data: {
        order: {
          order_id: testOrderId,
          order_amount: parseInt(testAmount, 10),
          order_status: 'PAID',
          order_note: 'bulk|COMMUNITY|12',
          order_currency: 'INR',
          customer_details: {
            customer_email: 'test@example.com',
            customer_name: 'Test User',
            customer_phone: '9999999999'
          }
        },
        payment: {
          cf_payment_id: 'test_' + Math.random(),
          payment_status: testStatus,
          payment_amount: parseInt(testAmount, 10),
          payment_time: new Date().toISOString(),
          payment_method: 'CARD'
        },
        customer_details: {
          customer_email: 'test@example.com',
          customer_name: 'Test User',
          customer_phone: '9999999999'
        }
      }
    };

    const rawBody = Buffer.from(JSON.stringify(payload));
    const ts = Math.floor(Date.now() / 1000).toString();

    // Create signature
    const SECRET = ENV.CASHFREE_SECRET_KEY || 'test-secret';
    const sig = crypto
      .createHmac('sha256', SECRET)
      .update(ts + rawBody.toString('utf8'))
      .digest('base64');

    console.log('[test-webhook] Created test webhook:');
    console.log('[test-webhook]   - Timestamp:', ts);
    console.log('[test-webhook]   - Signature:', sig);
    console.log('[test-webhook]   - Payload:', JSON.stringify(payload, null, 2));

    // Now manually process it
    const CFG2 = getConfig();
    const ENV2 = CFG2.private;
    
    // Simulate the webhook handling
    const order_id = payload.data.order.order_id;
    const paidAmt = payload.data.order.order_amount;
    const status = payload.data.payment.payment_status;

    console.log('[test-webhook] Processing:');
    console.log('[test-webhook]   - Order ID:', order_id);
    console.log('[test-webhook]   - Amount:', paidAmt);
    console.log('[test-webhook]   - Status:', status);

    // Check if status is SUCCESS
    if (status !== 'SUCCESS') {
      return respond(200, `Test: payment status is ${status}, skipping`);
    }

    // Create or reconstruct order
    const orderNote = 'bulk|COMMUNITY|12';
    const noteParts = orderNote.split('|');
    const noteType = noteParts[0];
    const noteQuantity = parseInt(noteParts[2] || '0', 10) || 0;

    const oc = {
      order_id,
      type: noteType,
      name: 'Test User',
      email: 'test@example.com',
      phone: '9999999999',
      amount: paidAmt,
      passes: noteType === 'bulk' ? noteQuantity : 0,
      recipients: ['test@example.com'],
      meta: {
        club_type: 'COMMUNITY',
        quantity: noteQuantity
      },
      created_at: new Date().toISOString(),
      cashfree: { env: 'sandbox', order: {} }
    };

    console.log('[test-webhook] Reconstructed order:');
    console.log('[test-webhook]   - passes:', oc.passes);
    console.log('[test-webhook]   - recipients:', oc.recipients);

    // Try to issue
    try {
      console.log('[test-webhook] Attempting to issue passes...');
      const issued = await issueComplimentaryPasses(ENV2, oc);
      
      console.log('[test-webhook] Issuance result:');
      console.log('[test-webhook]   - total:', issued.total);
      console.log('[test-webhook]   - created:', issued.created?.length);
      console.log('[test-webhook]   - errors:', issued.errors?.length);

      // Update with fulfillment
      oc.konfhub = {
        registrations: issued.created,
        last_issued_at: new Date().toISOString()
      };
      oc.fulfilled = {
        at: new Date().toISOString(),
        status: issued.errors?.length ? 'partial' : 'ok',
        count: issued.total
      };

      // Save to GitHub
      if (ENV2.GITHUB_TOKEN) {
        await putJson(ENV2, `${ENV2.STORE_PATH}/orders/${order_id}.json`, oc);
        console.log('[test-webhook] ✓ Order saved to GitHub');
      }

      return respond(200, {
        success: true,
        message: `Test webhook processed successfully. Issued ${issued.total} passes.`,
        order_id,
        fulfilled: oc.fulfilled
      });
    } catch (issueErr) {
      console.error('[test-webhook] Issuance error:', issueErr.message);
      return respond(500, `Issuance failed: ${issueErr.message}`);
    }

  } catch (e) {
    console.error('[test-webhook] Error:', e.message);
    console.error('[test-webhook] Stack:', e.stack);
    return respond(500, e.message);
  }
};

const respond = (statusCode, body) => {
  const response = {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-cache'
    },
    body: typeof body === 'string' ? JSON.stringify({ message: body }) : JSON.stringify(body)
  };
  console.log('[test-webhook] RESPONSE:', statusCode, body);
  return response;
};
