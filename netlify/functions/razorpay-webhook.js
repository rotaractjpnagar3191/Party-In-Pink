// netlify/functions/razorpay-webhook.js
// Handle Razorpay webhooks for payment events

const crypto = require("crypto");
const { getConfig } = require("./_config");
const { getJson, putJson } = require("./_github");
const { issueComplimentaryPasses } = require("./_konfhub");

const json = (s, b) => ({
  statusCode: s,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(b),
});

// Webhook deduplication
const webhookRegistry = new Map();

exports.handler = async (event) => {
  console.log("\n\n==============================================");
  console.log("[razorpay-webhook] ===== WEBHOOK INVOKED =====");
  console.log("[razorpay-webhook] Timestamp:", new Date().toISOString());
  console.log("[razorpay-webhook] Method:", event?.httpMethod);

  try {
    if (event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const CFG = getConfig();
    const ENV = CFG.private;

    // Verify webhook signature
    const sig = event.headers["x-razorpay-signature"];
    if (!sig) {
      console.warn("[razorpay-webhook] Missing signature");
      return json(400, { error: "Missing signature" });
    }

    const body = event.body || "";
    const webhookSecret = ENV.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("[razorpay-webhook] Webhook secret not configured");
      return json(500, { error: "Webhook not configured" });
    }

    // Verify signature
    const expectedSig = crypto.createHmac("sha256", webhookSecret).update(body).digest("hex");

    if (sig !== expectedSig) {
      console.error("[razorpay-webhook] Signature mismatch");
      console.log("[razorpay-webhook] Expected:", expectedSig);
      console.log("[razorpay-webhook] Got:", sig);
      return json(403, { error: "Invalid signature" });
    }

    console.log("[razorpay-webhook] ✓ Signature verified");

    // Parse webhook body
    const webhookData = JSON.parse(body);
    const eventType = webhookData.event;
    const paymentData = webhookData.payload?.payment?.entity || webhookData.payload?.entity || {};

    console.log("[razorpay-webhook] Event type:", eventType);
    console.log("[razorpay-webhook] Payment ID:", paymentData.id);
    console.log("[razorpay-webhook] Status:", paymentData.status);

    // Only process payment.authorized and payment.captured events
    if (eventType !== "payment.authorized" && eventType !== "payment.captured") {
      console.log("[razorpay-webhook] Ignoring event type:", eventType);
      return json(200, { ok: true });
    }

    // Only process successful payments
    if (paymentData.status !== "captured" && paymentData.status !== "authorized") {
      console.log("[razorpay-webhook] Payment not successful, status:", paymentData.status);
      return json(200, { ok: true });
    }

    const razorpay_order_id = paymentData.order_id;
    const razorpay_payment_id = paymentData.id;

    if (!razorpay_order_id) {
      console.error("[razorpay-webhook] Missing order_id");
      return json(400, { error: "Missing order_id" });
    }

    console.log(`[razorpay-webhook] Processing payment for order: ${razorpay_order_id}`);

    // Deduplicate webhooks
    const webhookKey = `${razorpay_payment_id}_${eventType}`;
    if (webhookRegistry.has(webhookKey)) {
      console.log("[razorpay-webhook] Duplicate webhook, ignoring");
      return json(200, { ok: true, duplicate: true });
    }
    webhookRegistry.set(webhookKey, Date.now());

    // Find order by razorpay_order_id
    let order = null;
    let order_id = null;

    try {
      // Try to get from all saved orders (this is a workaround - ideally we'd have a mapping)
      // For now, we'll get the order from GitHub storage
      // The order ID should be in the order record we saved earlier
      const storePrefix = ENV.STORE_PATH || "storage/orders";

      // We need to search GitHub for the order with this razorpay_order_id
      // For now, let's assume the order is stored and we can retrieve it
      console.log("[razorpay-webhook] Looking up order with razorpay_order_id:", razorpay_order_id);

      // Since we don't have direct search, we'll need to get it from Razorpay
      const rzpOrderRes = await fetch(`https://api.razorpay.com/v1/orders/${razorpay_order_id}`, {
        method: "GET",
        headers: {
          Authorization: `Basic ${Buffer.from(`${ENV.RAZORPAY_KEY_ID}:${ENV.RAZORPAY_KEY_SECRET}`).toString("base64")}`,
        },
      });

      const rzpOrder = await rzpOrderRes.json();
      const pip_order_id = rzpOrder?.receipt;

      if (!pip_order_id) {
        console.error("[razorpay-webhook] Could not find order receipt");
        return json(400, { error: "Order not found" });
      }

      console.log(`[razorpay-webhook] Found order: ${pip_order_id}`);

      // Get order from GitHub
      try {
        order = await getJson(ENV, `${ENV.STORE_PATH}/orders/${pip_order_id}.json`);
        order_id = pip_order_id;
      } catch (e) {
        console.error("[razorpay-webhook] Could not get order from GitHub:", e.message);
        return json(404, { error: "Order not found in storage" });
      }
    } catch (e) {
      console.error("[razorpay-webhook] Order lookup error:", e.message);
      return json(500, { error: "Order lookup failed" });
    }

    if (!order) {
      console.error("[razorpay-webhook] Order is null");
      return json(404, { error: "Order not found" });
    }

    console.log(`[razorpay-webhook] Order retrieved: passes=${order.passes}, recipients=${order.recipients?.length}`);

    // Validate order has required fields
    if (!order.passes || order.passes < 1 || !Array.isArray(order.recipients)) {
      console.error("[razorpay-webhook] Invalid order data", { passes: order.passes, recipients: order.recipients });
      return json(400, { error: "Invalid order data" });
    }

    // Issue tickets via KonfHub
    console.log(`[razorpay-webhook] Issuing ${order.passes} pass(es) for ${order.email}`);

    let fulfillmentResult;
    try {
      fulfillmentResult = await issueComplimentaryPasses({
        passes: order.passes,
        email: order.email,
        recipients: order.recipients,
        env: ENV,
      });

      console.log("[razorpay-webhook] KonfHub response:", fulfillmentResult);
    } catch (e) {
      console.error("[razorpay-webhook] KonfHub error:", e.message);
      fulfillmentResult = {
        success: false,
        error: e.message,
        status: "failed",
      };
    }

    // Update order with fulfillment status
    const fulfilled = fulfillmentResult.success
      ? { status: "ok", timestamp: new Date().toISOString(), details: fulfillmentResult }
      : { status: "partial", timestamp: new Date().toISOString(), error: fulfillmentResult.error };

    order.fulfilled = fulfilled;
    order.razorpay = order.razorpay || {};
    order.razorpay.payment_id = razorpay_payment_id;
    order.razorpay.payment = paymentData;
    order.razorpay_webhook_processed = new Date().toISOString();

    // Save updated order back to GitHub
    try {
      await putJson(ENV, `${ENV.STORE_PATH}/orders/${order_id}.json`, order);
      console.log(`[razorpay-webhook] ✓ Order updated with fulfillment status`);
    } catch (e) {
      console.error("[razorpay-webhook] Failed to update order:", e.message);
    }

    if (fulfillmentResult.success) {
      console.log(`[razorpay-webhook] ✓ Tickets issued successfully`);
      return json(200, { ok: true, fulfilled: true });
    } else {
      console.error(`[razorpay-webhook] Ticket issuance failed`);
      return json(200, { ok: true, fulfilled: false, error: fulfillmentResult.error });
    }
  } catch (e) {
    console.error("[razorpay-webhook] Unhandled error:", e);
    return json(500, { error: e.message });
  }
};
