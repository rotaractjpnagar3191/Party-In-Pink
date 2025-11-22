// netlify/functions/create-order-razorpay.js
// Create a Razorpay order for payments

const { getConfig, normalizeINPhone, isValidINMobile, mapAmountToPasses, getTierName } = require("./_config");
const { putJson, getJson } = require("./_github");

const json = (s, b) => ({
  statusCode: s,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(b),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const CFG = getConfig();
    const ENV = CFG.private;
    const PUB = CFG.public;

    // Validate Razorpay config
    if (!ENV.RAZORPAY_KEY_ID || !ENV.RAZORPAY_KEY_SECRET) {
      console.error("[create-order-razorpay] Missing Razorpay credentials");
      return json(500, { error: "Razorpay not configured" });
    }

    const body = JSON.parse(event.body || "{}");
    const { type, name, email, phone, club_type, quantity, meta } = body;

    console.log(`[create-order-razorpay] Creating order: ${type} for ${email}`);

    // Validate inputs
    if (!type || !name || !email || !phone) {
      return json(400, { error: "Missing required fields" });
    }

    if (!isValidINMobile(normalizeINPhone(phone))) {
      return json(400, { error: "Invalid phone number" });
    }

    // Calculate amount and passes
    let amount = 0;
    let passes = 0;
    let recipients = [];

    if (type === "bulk") {
      // Bulk registration
      const clubName = meta?.club_name || club_type || "Community";
      amount = meta?.quantity ? Math.max(1, Math.round(meta.quantity)) * (meta?.price_per || 199) : 199;
      passes = Math.max(1, Math.round(meta?.quantity || 1));
      recipients = Array(passes).fill(clubName).map((c, i) => `${c} Attendee ${i + 1}`);
    } else if (type === "donation") {
      // Donation
      amount = meta?.amount ? Math.round(meta.amount) : 1000;
      passes = meta?.passes ? Math.round(meta.passes) : 1;
      recipients = Array(passes).fill("Donor Ticket");
    } else if (type === "single") {
      // Single registration
      amount = meta?.amount || 199;
      passes = 1;
      recipients = [name];
    }

    // Validate amount
    if (amount < 1 || !Number.isFinite(amount)) {
      return json(400, { error: "Invalid amount" });
    }

    // Create order ID
    const order_id = `pip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[create-order-razorpay] Amount: ${amount}, Passes: ${passes}`);

    // Create Razorpay order
    const razorpayOrderPayload = {
      amount: amount * 100, // Razorpay uses paise (1 INR = 100 paise)
      currency: "INR",
      receipt: order_id,
      description: `${type === "bulk" ? "Bulk Registration" : type === "donation" ? "Donation" : "Registration"} - Party In Pink`,
      customer_notif: 1,
      notes: {
        type,
        name,
        email,
        phone,
        club_type: club_type || "",
        quantity: quantity || passes,
        order_id,
      },
    };

    console.log("[create-order-razorpay] Creating Razorpay order:", JSON.stringify(razorpayOrderPayload, null, 2));

    // Call Razorpay API
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 10000);

    let razorpayRes;
    try {
      razorpayRes = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${ENV.RAZORPAY_KEY_ID}:${ENV.RAZORPAY_KEY_SECRET}`).toString("base64")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(razorpayOrderPayload),
        signal: abortController.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const razorpayJson = await razorpayRes.json().catch(() => ({}));

    if (!razorpayRes.ok) {
      console.error("[create-order-razorpay] Razorpay API error:", razorpayJson);
      return json(400, { error: "Razorpay order creation failed", details: razorpayJson });
    }

    const razorpay_order_id = razorpayJson?.id;
    if (!razorpay_order_id) {
      console.error("[create-order-razorpay] No order ID from Razorpay");
      return json(502, { error: "No order ID from Razorpay", details: razorpayJson });
    }

    console.log(`[create-order-razorpay] ✓ Razorpay order created: ${razorpay_order_id}`);

    // Save order record to GitHub
    const record = {
      order_id,
      razorpay_order_id,
      type,
      name,
      email,
      phone,
      amount,
      passes,
      recipients,
      meta,
      created_at: new Date().toISOString(),
      razorpay: { order: razorpayJson },
    };

    try {
      if (ENV.GITHUB_TOKEN) {
        await putJson(ENV, `${ENV.STORE_PATH}/orders/${order_id}.json`, record);
        console.log(`[create-order-razorpay] ✓ Order saved to GitHub: ${order_id}`);
      }
    } catch (e) {
      console.error(`[create-order-razorpay] Failed to save to GitHub: ${e.message}`);
    }

    return json(200, {
      order_id,
      razorpay_order_id,
      amount,
      currency: "INR",
      key_id: ENV.RAZORPAY_KEY_ID,
      // Razorpay SDK will handle the checkout directly
    });
  } catch (e) {
    console.error("[create-order-razorpay] Error:", e);
    if (e.name === "AbortError") {
      return json(504, { error: "Payment service timeout" });
    }
    return json(500, { error: e.message || "Server error" });
  }
};
