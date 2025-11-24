// kh-webhook.js - Konfhub webhook handler
const { saveJSON, loadJSON } = require('./_utils');

exports.handler = async (event) => {
  try {
    // ... your existing logic ...
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
