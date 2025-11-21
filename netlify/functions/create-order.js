// create-order.js
const { getConfig, normalizeINPhone, isValidINMobile, mapAmountToPasses } = require("./_config");
const { putJson } = require("./_github");

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
      const club_type = ["COMMUNITY", "UNIVERSITY"].includes(clubTypeRaw) ? clubTypeRaw : "COMMUNITY";
      const min = club_type === "UNIVERSITY" ? parseInt(PUB.UNIV_MIN || "20", 10) : parseInt(PUB.COMM_MIN || "12", 10);
      const quantity = Math.max(min, parseInt(body.quantity || body.count || "0", 10) || 0);

      // enforce min
      if (quantity < min) {
        return json(400, { error: `Minimum ${min} passes for ${club_type.toLowerCase()} clubs` });
      }

      const price = parseInt(PUB.BULK_PRICE || "199", 10);
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
        meta = { tier: amt };
      } else if (custom && custom > 0) {
        amount = custom;
        // Map custom amount to passes using slabs
        passes = mapAmountToPasses(
          custom,
          CFG.public.SLABS,
          1,  // below minimum gets 1 complimentary pass
          ENV.SLAB_ABOVE_MAX || 'TOP'
        );
        meta = { tier: "CUSTOM", amount: custom };
      } else {
        return json(400, { error: "Invalid tier or amount" });
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
      },
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
