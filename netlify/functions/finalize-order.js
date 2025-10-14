// netlify/functions/finalize-order.js
exports.handler = async (event) => {
  try {
    const { order_id } = JSON.parse(event.body||'{}');
    // TODO: verify with Cashfree & trigger issuance.
    // For dev, just respond OK so the client overlay doesn't log 404.
    return { statusCode: 200, body: JSON.stringify({ ok: true, order_id }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ ok: true }) }; // keep non-fatal in dev
  }
};
