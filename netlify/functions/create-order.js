// create-order.js
const { getConfig, normalizeINPhone, isValidINMobile, mapAmountToPasses, getTierName } = require("./_config");
const { putJson, getJson } = require("./_github");

// ===== RATE LIMITING =====
const rateLimitMap = new Map(); // IP -> { count, timestamp }
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 requests per minute

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry) {
    rateLimitMap.set(ip, { count: 1, timestamp: now });
    return true; // Allow first request
  }

  if (now - entry.timestamp > RATE_LIMIT_WINDOW) {
    // Window expired, reset
    rateLimitMap.set(ip, { count: 1, timestamp: now });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    console.warn(`[create-order] 🚫 RATE LIMIT EXCEEDED for IP: ${ip} (${entry.count} requests in ${Math.round((now - entry.timestamp) / 1000)}s)`);
    return false;
  }

  entry.count++;
  return true;
}

// ===== STANDARDIZED ERROR RESPONSES =====
const ErrorResponse = {
  INVALID_INPUT: { code: 400, message: 'Invalid input provided' },
  UNAUTHORIZED: { code: 401, message: 'Unauthorized' },
  DUPLICATE: { code: 409, message: 'Duplicate registration detected' },
  PAYMENT_FAILED: { code: 402, message: 'Payment processing failed' },
  SERVICE_ERROR: { code: 503, message: 'Service temporarily unavailable' },
  INVALID_AMOUNT: { code: 400, message: 'Invalid amount or pricing' }
};

const json = (s, b) => ({
  statusCode: s,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(b),
});

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

// ===== VALIDATION HELPERS =====
function validateAmount(amount, type, min, max) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw { code: 400, error: 'Amount must be positive', type: 'INVALID_AMOUNT' };
  }
  if (amount < min) {
    throw { code: 400, error: `Minimum amount ₹${min}`, type: 'AMOUNT_TOO_LOW' };
  }
  if (amount > max) {
    throw { code: 400, error: `Maximum amount ₹${max}`, type: 'AMOUNT_TOO_HIGH' };
  }
  return amount;
}

function validatePasses(passes, type, min, max) {
  passes = Number(passes || 0);
  if (!Number.isFinite(passes) || passes < 0) {
    throw { code: 400, error: 'Invalid passes count', type: 'INVALID_PASSES' };
  }
  if (type === 'bulk' && passes < min) {
    throw { code: 400, error: `Bulk minimum: ${min} passes`, type: 'PASSES_BELOW_MIN' };
  }
  if (passes > 1000) {
    throw { code: 400, error: 'Maximum 1000 passes per order', type: 'PASSES_TOO_HIGH' };
  }
  return passes;
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
    
    // ✅ RATE LIMITING CHECK
    const clientIP = event.headers['client-ip'] || event.headers['x-forwarded-for']?.split(',')[0] || event.headers['x-real-ip'] || 'unknown';
    if (!checkRateLimit(clientIP)) {
      console.warn(`[create-order] 🚫 Rate limit exceeded for ${clientIP}`);
      return json(429, { error: "Too many requests. Please try again in 1 minute." });
    }

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
    
    // Validate recipients
    const validRecipients = recipients
      .map(r => String(r).trim().toLowerCase())
      .filter(r => r.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r)); // Basic email regex
    
    if (validRecipients.length === 0) {
      return json(400, { 
        error: 'At least one valid recipient email required',
        type: 'INVALID_RECIPIENTS'
      });
    }

    if (type === "bulk") {
      const clubTypeRaw = String(body.club_type || body.clubType || "").toUpperCase();
      let club_type, min, price;

      // Determine club type, minimum passes, and price per pass
      if (clubTypeRaw === "CORPORATE") {
        club_type = "CORPORATE";
        min = parseInt(PUB.CORP_MIN || "15", 10);
        price = parseInt(PUB.CORP_PRICE || "300", 10);
      } else if (clubTypeRaw === "UNIVERSITY") {
        club_type = "UNIVERSITY";
        min = parseInt(PUB.UNIV_MIN || "20", 10);
        price = parseInt(PUB.UNIV_PRICE || "199", 10);
      } else {
        club_type = "COMMUNITY";
        min = parseInt(PUB.COMM_MIN || "12", 10);
        price = parseInt(PUB.COMM_PRICE || "199", 10);
      }

      const quantity = Math.max(min, parseInt(body.quantity || body.count || "0", 10) || 0);

      // ✅ VALIDATION: Passes within acceptable range
      try {
        passes = validatePasses(quantity, 'bulk', min, 1000);
      } catch (err) {
        return json(err.code, { error: err.error, type: err.type });
      }

      amount = passes * price;
      
      // ✅ VALIDATION: Amount matches passes * price
      try {
        validateAmount(amount, 'bulk', min * price, 300000); // Max ₹3L
      } catch (err) {
        return json(err.code, { error: err.error, type: err.type });
      }

      meta = {
        club_type,
        club_name: String(body.club_name || body.clubName || "").trim(),
        quantity: passes,
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
        if (!slabMap.has(amt)) {
          return json(400, { error: "Invalid tier or amount", type: 'INVALID_TIER' });
        }
        amount = amt;
        passes = slabMap.get(amt) || 0;
        meta = { tier: getTierName(amt) };
      } else if (custom && custom > 0) {
        amount = custom;
        // ✅ VALIDATION: Custom amount within bounds
        try {
          validateAmount(amount, 'donation', 100, 500000); // ₹100 to ₹5L
        } catch (err) {
          return json(err.code, { error: err.error, type: err.type });
        }
        // Map custom amount to passes using slabs
        passes = mapAmountToPasses(
          custom,
          CFG.public.SLABS,
          1,  // below minimum gets 1 complimentary pass
          ENV.SLAB_ABOVE_MAX || 'TOP'
        );
        meta = { tier: getTierName(custom), amount: custom };
      } else {
        return json(400, { error: "Invalid tier or amount", type: 'INVALID_AMOUNT' });
      }
    }

    // ---------- IDEMPOTENCY CHECK: Find existing unfulfilled order ----------
    const existingOrder = await findExistingOrder(ENV, email, type, amount);
    if (existingOrder) {
      // Only reuse if it has valid payment details
      const existingLink = existingOrder.cashfree?.data?.payment_link || existingOrder.cashfree?.payment_link;
      const existingSessionId = existingOrder.cashfree?.data?.payment_session_id || existingOrder.cashfree?.payment_session_id;
      
      if (existingLink && existingSessionId) {
        console.log(`[create-order] Returning existing order for idempotency: ${existingOrder.order_id}`);
        return json(200, {
          order_id: existingOrder.order_id,
          cf_env: (ENV.CASHFREE_ENV || "sandbox").toLowerCase(),
          payment_link: existingLink,
          payment_session_id: existingSessionId,
          reused: true,
        });
      } else {
        console.log(`[create-order] Found existing order but missing payment details, creating fresh one: ${existingOrder.order_id}`);
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
      order_splits: [],
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
      recipients: validRecipients, // ✅ Use validated recipients
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

    // Update lightweight email -> orders index to speed up lookups (best-effort)
    try {
      const indexPath = `${ENV.STORE_PATH}/index_by_email.json`;
      let index = {};
      try { index = (await getJson(ENV, indexPath)) || {}; } catch (_) { index = {}; }
      const e = (email || '').toLowerCase();
      if (!index[e]) index[e] = [];
      // Keep most recent first and bounded to 10 entries
      index[e].unshift(order_id);
      index[e] = Array.from(new Set(index[e])).slice(0, 10);
      await putJson(ENV, indexPath, index);
      console.log('[create-order] ✓ Updated index_by_email for', e);
    } catch (idxErr) {
      console.warn('[create-order] ⚠️  Failed to update index_by_email:', idxErr?.message || idxErr);
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
