// simple JSON store used in local/dev; writes to STORE_PATH
const fs = require("fs").promises;
const path = require("path");
// kh-webhook.js
const { saveJSON } = require('./_utils');

exports.handler = async (event) => {
  try {
    // ... your existing logic ...
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};

const ROOT = process.env.STORE_PATH || path.join(".netlify", "tmp");

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function saveJSON(name, data) {
  const file = name.endsWith(".json") ? name : `${name}.json`;
  const out = path.join(ROOT, file);
  await ensureDir(path.dirname(out));
  await fs.writeFile(out, JSON.stringify(data, null, 2), "utf8");
  return out;
}

async function loadJSON(name, fallback = null) {
  try {
    const file = name.endsWith(".json") ? name : `${name}.json`;
    const p = path.join(ROOT, file);
    const buf = await fs.readFile(p, "utf8");
    return JSON.parse(buf);
  } catch (e) {
    return fallback;
  }
}

module.exports = { saveJSON, loadJSON };
