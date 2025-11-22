// create-order.js
const { getConfig, normalizeINPhone, isValidINMobile, mapAmountToPasses, getTierName } = require("./_config");
const { putJson, getJson } = require("./_github");

const json = (s, b) => ({
  statusCode: s,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(b),
});

// Verify an existing payment from Cashfree (for reused orders)
async function verifyExistingPayment(ENV, cfOrderData) {
  try {
    if (!cfOrderData?.payment_session_id && !cfOrderData?.order_id) {
      console.log('[create-order] No payment session to verify');
      return { verified: false, reason: 'No payment session' };
    }

    const cfEnv = (ENV.CASHFREE_ENV || "sandbox").toLowerCase();
    const cfBase = cfEnv === "production" 
      ? "https://api.cashfree.com" 
      : "https://sandbox.cashfree.com";
    
    const apiVersion = ENV.CASHFREE_API_VERSION && /^\d{4}-\d{2}-\d{2}$/.test(ENV.CASHFREE_API_VERSION)
      ? ENV.CASHFREE_API_VERSION
      : "2025-01-01";

    const order_id = cfOrderData.order_id || cfOrderData.payment_session_id;

    // Create AbortController with 8s timeout (don't block order creation too long)
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 8000);

    let response;
    try {
      response = await fetch(`${cfBase}/pg/orders/${order_id}`, {
        method: "GET",
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
      console.log('[create-order] Could not verify payment:', response.status);
      return { verified: false, reason: `API error ${response.status}` };
    }

    const orderData = await response.json();
    
    // Check if there's a successful payment
    const hasSuccessfulPayment = orderData.payments?.some(p => 
      p.payment_status === 'SUCCESS' || p.payment_status === 'success'
    );

    if (hasSuccessfulPayment) {
      console.log('[create-order] ✓ Existing payment verified for reuse');
      return { verified: true };
    }

    console.log('[create-order] No successful payment found for reused order');
    return { verified: false, reason: 'No successful payment' };

  } catch (err) {
    console.log('[create-order] Payment verification error (non-blocking):', err.message);
    // Don't fail - let webhook handle verification
    return { verified: false, reason: err.message };
  }
}

// Parse "5000:2,10000:5,15000:7,..." -> Map( amount -> passes )
function parseSlabs(str) {
  const m = new Map();
  String(str || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const [a, p] = pair.split(":").map((x) => parseInt(String(x).trim(), 10));
      if (Number.isFinite(a)) m.set(a, Number.isFinite(p) ? p : 0);
    });
  return m;
}

// Check for existing order with same email+type+amount (idempotency)
async function findExistingOrder(ENV, email, type, amount) {
  if (!ENV.GITHUB_TOKEN) return null;
  
  try {
    // List files in storage/orders/ folder
    const resp = await fetch(
      `https://api.github.com/repos/${ENV.GITHUB_OWNER}/${ENV.GITHUB_REPO}/contents/${ENV.STORE_PATH}/orders`,
      {
        headers: {
          Authorization: `token ${ENV.GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
        },
      }
    );

    if (!resp.ok) {
      console.log(`[create-order] Could not list orders folder (404 or error): ${resp.status}`);
      return null;
    }

    const files = await resp.json();
    if (!Array.isArray(files)) return null;

    // Scan each order file for matching email+type+amount
    for (const file of files) {
      if (!file.name.endsWith(".json")) continue;

      const orderData = await getJson(ENV, `${ENV.STORE_PATH}/orders/${file.name}`);
      if (!orderData) continue;

      // Match: same email, type, and amount
      if (
        orderData.email === email &&
        orderData.type === type &&
        orderData.amount === amount
      ) {
        // Check if NOT already fulfilled (so we can reuse it)
        const fulfilled = orderData.fulfilled?.status === "ok" || orderData.fulfilled?.status === "partial";
        if (!fulfilled) {
          console.log(`[create-order] ✓ Found existing unfullfilled order: ${orderData.order_id}`);
          return orderData;
        }
      }
    }
  } catch (err) {
    console.error(`[create-order] Error checking for existing orders: ${err.message}`);
  }

  return null;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });
    const body = JSON.parse(event.body || "{}");

    const CFG = getConfig();
    const PUB = CFG.public;
    const ENV = CFG.private;

    const type = String(body.type || "").toLowerCase();
    if (!["bulk", "donation"].includes(type)) return json(400, { error: "Invalid type" });

    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const phone = normalizeINPhone(body.phone);
    if (!name || !email || !isValidINMobile(phone)) {
      return json(400, { error: "Invalid name/email/phone" });
    }

    // ---------- compute amount + meta ----------
    let amount = 0;
    let passes = 0;
    let meta = {};
    let recipients = Array.isArray(body.recipients) ? body.recipients.filter(Boolean) : [];
    if (!recipients.length) recipients = [email];

    if (type === "bulk") {
      const clubTypeRaw = String(body.club_type || body.clubType || "").toUpperCase();
      const club_type = ["COMMUNITY", "UNIVERSITY", "CORPORATE"].includes(clubTypeRaw) ? clubTypeRaw : "COMMUNITY";
      
      // Get pricing based on club type
      let min, price;
      if (club_type === "UNIVERSITY") {
        min = parseInt(PUB.UNIV_MIN || "20", 10);
        price = parseInt(PUB.BULK_PRICE || "199", 10);
      } else if (club_type === "CORPORATE") {
        min = parseInt(PUB.CORP_MIN || "15", 10);
        price = parseInt(PUB.CORP_PRICE || "300", 10);
      } else {
        min = parseInt(PUB.COMM_MIN || "12", 10);
        price = parseInt(PUB.BULK_PRICE || "199", 10);
      }
      
      const quantity = Math.max(min, parseInt(body.quantity || body.count || "0", 10) || 0);

      // enforce min
      if (quantity < min) {
        return json(400, { error: `Minimum ${min} passes for ${club_type.toLowerCase()} clubs` });
      }

      amount = quantity * price;
      passes = quantity;
      meta = {
        club_type,
        club_name: String(body.club_name || body.clubName || "").trim(),
        quantity,
        ui_club_type: String(body.ui_club_type || "").trim(),
        price_per: price,
      };
    } else {
      // DONATION
      const slabMap = parseSlabs(PUB.SLABS);
      const tierRaw = body.tier != null ? String(body.tier).trim() : null;
      const custom = body.custom_amount != null ? parseInt(body.custom_amount, 10) : null;

      if (tierRaw && /^\d+$/.test(tierRaw)) {
        // tier equals the amount (e.g. "5000")
        const amt = parseInt(tierRaw, 10);
        if (!slabMap.has(amt)) return json(400, { error: "Invalid tier or amount" });
        amount = amt;
        passes = slabMap.get(amt) || 0;
        meta = { tier: getTierName(amt) };
      } else if (custom && custom > 0) {
        amount = custom;
        // Map custom amount to passes using slabs
        passes = mapAmountToPasses(
          custom,
          CFG.public.SLABS,
          1,  // below minimum gets 1 complimentary pass
          ENV.SLAB_ABOVE_MAX || 'TOP'
        );
        meta = { tier: getTierName(custom), amount: custom };
      } else {
        return json(400, { error: "Invalid tier or amount" });
      }
    }

    // ---------- IDEMPOTENCY CHECK: Find existing unfulfilled order ----------
    const existingOrder = await findExistingOrder(ENV, email, type, amount);
    if (existingOrder && existingOrder.cashfree?.data?.payment_session_id) {
      // Verify payment before reusing
      console.log(`[create-order] Found existing order: ${existingOrder.order_id}, verifying payment...`);
      const paymentVerified = await verifyExistingPayment(ENV, existingOrder.cashfree?.data || {});
      
      if (paymentVerified.verified) {
        console.log(`[create-order] ✓ Reusing existing order with verified payment: ${existingOrder.order_id}`);
        return json(200, {
          order_id: existingOrder.order_id,
          cf_env: (ENV.CASHFREE_ENV || "sandbox").toLowerCase(),
          payment_link: existingOrder.cashfree?.data?.payment_link || existingOrder.cashfree?.payment_link,
          payment_session_id: existingOrder.cashfree?.data?.payment_session_id || existingOrder.cashfree?.payment_session_id,
          reused: true,
          payment_verified: true,
        });
      } else {
        console.log(`[create-order] ⚠️  Existing order payment verification failed: ${paymentVerified.reason}`);
        // Fall through to create a new order
      }
    }

    // ---------- create Cashfree order ----------
    const cfEnv = (ENV.CASHFREE_ENV || "sandbox").toLowerCase();
    const cfBase = cfEnv === "production" ? "https://api.cashfree.com" : "https://sandbox.cashfree.com";
    const apiVersion = ENV.CASHFREE_API_VERSION && /^\d{4}-\d{2}-\d{2}$/.test(ENV.CASHFREE_API_VERSION)
      ? ENV.CASHFREE_API_VERSION
      : "2022-09-01"; // ✅ safe default

    const order_id = `pip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const orderPayload = {
      order_id,
      order_amount: amount,
      order_currency: "INR",
      order_note: `${type}|${meta.tier || meta.club_type || ""}|${meta.quantity || ""}`,
      customer_details: {
        customer_id: email.replace(/[^\w-]/g, "_").slice(0, 32) || "guest",
        customer_email: email,
        customer_phone: phone,
        customer_name: name,
      },
      order_meta: {
        return_url: `${PUB.SITE_URL}/success.html?order=${order_id}&type=${type}`,
        notify_url: `${PUB.SITE_URL}/api/cf-webhook`,
        cancel_url: `${PUB.SITE_URL}/cancel.html?order=${order_id}&type=${type}`,
      },
      // Enable verify_pay feature for fraud prevention
      products: {
        verify_pay: {
          enabled: true
        }
      }
    };

    // Create AbortController with 10s timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 10000);

    let cfRes;
    try {
      cfRes = await fetch(`${cfBase}/pg/orders`, {
        method: "POST",
        headers: {
          "x-client-id": ENV.CASHFREE_APP_ID,
          "x-client-secret": ENV.CASHFREE_SECRET_KEY,
          "x-api-version": apiVersion,
          "content-type": "application/json",
        },
        body: JSON.stringify(orderPayload),
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const cfJson = await cfRes.json().catch(() => ({}));
    if (!cfRes.ok) {
      return json(400, { error: "Cashfree create order failed", details: cfJson });
    }

    const payment_session_id =
      cfJson?.payment_session_id || cfJson?.data?.payment_session_id || null;
    const payment_link =
      cfJson?.payment_link || cfJson?.data?.payment_link || null;

    if (!payment_session_id && !payment_link) {
      return json(502, { error: "No payment session returned", details: cfJson });
    }

    // Save order record to GitHub (for webhook lookup)
    const record = {
      order_id,
      type,
      name,
      email,
      phone,
      amount,
      passes,
      recipients,
      meta,
      created_at: new Date().toISOString(),
      cashfree: { env: cfEnv, order: cfJson },
    };
    
    // Try to save to GitHub (webhook will reconstruct if this fails)
    try {
      if (ENV.GITHUB_TOKEN) {
        await putJson(ENV, `${ENV.STORE_PATH}/orders/${order_id}.json`, record);
      } else {
        console.warn(`create-order: GITHUB_TOKEN not set, webhook will reconstruct order ${order_id}`);
      }
    } catch (e) {
      console.error(`create-order: Failed to save order to GitHub: ${e.message}`);
      // Don't fail the payment - webhook will reconstruct
    }

    return json(200, {
      order_id,
      cf_env: cfEnv,
      payment_link,
      payment_session_id,
    });
  } catch (e) {
    console.error("create-order error", e);
    // Handle timeout specifically
    if (e.name === "AbortError") {
      return json(504, { error: "Payment service timeout. Please try again." });
    }
    return json(500, { error: e.message || "Server error" });
  }
};
