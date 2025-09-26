// ...unchanged imports...
const { getConfig, normalizeINPhone, isValidINMobile } = require('./_config');
const { putJson } = require('./_github');

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return res(405, { error: 'Method not allowed' });
    const body = JSON.parse(event.body || '{}');

    const CFG = getConfig();
    const PUB = CFG.public, ENV = CFG.private;

    const type = String(body.type || '');
    if (!['bulk','donation'].includes(type)) return res(400, { error: 'Invalid type' });

    const name = String(body.name||'').trim();
    const email = String(body.email||'').trim();
    const phone = normalizeINPhone(body.phone);
    if (!name || !email || !isValidINMobile(phone)) return res(400, { error: 'Invalid name/email/phone' });

    let amount = 0, passes = 0, meta = {}, recipients = [];

    if (type === 'bulk') {
      const club_type = String(body.club_type||'').toUpperCase();
      const quantity = Math.max(0, parseInt(body.quantity,10)||0);
      if (!['COMMUNITY','UNIVERSITY'].includes(club_type)) return res(400, { error: 'Invalid club_type' });

      const min = club_type === 'COMMUNITY' ? PUB.COMM_MIN : PUB.UNIV_MIN;
      if (quantity < min) return res(400, { error: `Minimum ${min} passes for ${club_type.toLowerCase()} clubs` });

      passes = quantity;
      amount = quantity * PUB.BULK_PRICE;
      meta = { club_type, club_name: String(body.club_name||'').trim(), quantity };

      recipients = Array.isArray(body.recipients) ? body.recipients.filter(Boolean) : [];
      if (!recipients.length) recipients = [email];

    } else {
      const tier = String(body.tier || '');
      const custom = body.custom_amount != null ? Math.max(0, parseInt(body.custom_amount,10)||0) : null;

      const tierMap = new Map([
        ['WELLWISHER', { amount: 5000, passes: 2 }],
        ['SILVER',     { amount: 10000, passes: 5 }],
        ['GOLD',       { amount: 15000, passes: 7 }],
        ['CORPORATE',  { amount: 20000, passes: 7 }],
        ['PLATINUM',   { amount: 25000, passes: 10 }]
      ]);

      if (custom && custom >= 100) {
        amount = custom;
        meta = { tier: 'CUSTOM' };
      } else {
        if (!tierMap.has(tier)) return res(400, { error: 'Invalid tier or amount' });
        ({ amount, passes } = tierMap.get(tier));
        meta = { tier };
      }

      recipients = Array.isArray(body.recipients) ? body.recipients.filter(Boolean) : [];
      if (!recipients.length) recipients = [email];
    }

    const cfBase = ENV.CASHFREE_ENV === 'production' ? 'https://api.cashfree.com' : 'https://sandbox.cashfree.com';
    const order_id = `pip_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

    const orderPayload = {
      order_id,
      order_amount: amount,
      order_currency: 'INR',
      customer_details: {
        customer_id: email.replace(/[^\w-]/g,'_').slice(0,32) || 'guest',
        customer_email: email,
        customer_phone: phone,
        customer_name: name
      },
      order_meta: {
        // 👉 send the customer to a real success page with the order id & type
        return_url: `${CFG.public.SITE_URL}/success.html?order=${order_id}&type=${type}`,
        payment_methods: 'upi',
        notify_url: `${CFG.public.SITE_URL}/api/cf-webhook`
      },
      order_note: `${type}|${meta.tier||meta.club_type||''}|${meta.quantity||''}`
    };

    const cfRes = await fetch(`${cfBase}/pg/orders`, {
      method: 'POST',
      headers: {
        'x-client-id': ENV.CASHFREE_APP_ID,
        'x-client-secret': ENV.CASHFREE_SECRET_KEY,
        'x-api-version': ENV.CASHFREE_API_VERSION,
        'content-type': 'application/json'
      },
      body: JSON.stringify(orderPayload)
    });
    const cfJson = await cfRes.json().catch(()=> ({}));
    if (!cfRes.ok) return res(400, { error: 'Cashfree create order failed', details: cfJson });

    const payment_session_id = cfJson?.payment_session_id || cfJson?.data?.payment_session_id || null;
    const payment_link = cfJson?.payment_link || cfJson?.data?.payment_link || null;
    if (!payment_session_id && !payment_link) return res(502, { error: 'No payment session returned' });

    const oc = {
      order_id, type, name, email, phone, amount, passes, recipients, meta,
      created_at: new Date().toISOString(), cashfree: { order: cfJson }
    };
    if (ENV.GITHUB_TOKEN) {
      await putJson(ENV, `${ENV.STORE_PATH}/orders/${order_id}.json`, oc);
    }

    return res(200, { order_id, cf_env: ENV.CASHFREE_ENV, payment_session_id, payment_link });
  } catch (e) {
    console.error('create-order error', e);
    return res(500, { error: e.message });
  }
};

const res = (status, body) => ({ statusCode: status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
