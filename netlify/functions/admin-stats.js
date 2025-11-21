// netlify/functions/admin-stats.js
// Aggregates ops stats across:
//   • GitHub ledger orders (bulk + donation) in <STORE_PATH>/orders/*.json
//   • KonfHub webhook logs for single registrations in <STORE_PATH>/konfhub[/events]/*.json
//
// NEW: Returns a `tickets` block with total and breakdown: { single, donation, bulk }.
// Retains `donations` (count, amount, passes) and issuance stats.
//
// Required env:
//   ADMIN_KEY (or OPS_ADMIN_KEY)
//   GITHUB_OWNER=rotaractjpnagar3191
//   GITHUB_REPO=pip-tickets-data
//   GITHUB_TOKEN (repo read token)
//   STORE_PATH=storage
// Optional:
//   GITHUB_BRANCH (default "main")
//   KH_SINGLE_EVENT_IDS = comma-separated KonfHub event IDs for public single-registration event(s)
//   KH_INTERNAL_EVENT_IDS = comma-separated internal event IDs (optional; not required)

const DEFAULT_LIMIT = 30;

function cfg() {
  return {
    ADMIN_KEY: process.env.ADMIN_KEY || process.env.OPS_ADMIN_KEY || "",
    OWNER: process.env.GITHUB_OWNER || "",
    REPO: process.env.GITHUB_REPO || "",
    TOKEN: process.env.GITHUB_TOKEN || "",
    BRANCH: process.env.GITHUB_BRANCH || process.env.BRANCH || "main",
    STORE_PATH: process.env.STORE_PATH || "storage",
    KH_SINGLE_EVENT_IDS: (process.env.KH_SINGLE_EVENT_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    KH_INTERNAL_EVENT_IDS: (process.env.KH_INTERNAL_EVENT_IDS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

// ---------- HTTP helpers ----------
function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  };
}

const ghHeaders = (token) =>
  token
    ? {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
      }
    : { Accept: "application/vnd.github+json" };

// Encode each path segment; keep slashes intact (prevents 404 on GitHub API).
function encPath(path) {
  return String(path)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

// ---------- GitHub content ----------
async function listFilesGitHub({ OWNER, REPO, TOKEN, BRANCH, path, limit }) {
  const url =
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${encPath(path)}` +
    `?ref=${encodeURIComponent(BRANCH)}`;
  const res = await fetch(url, { headers: ghHeaders(TOKEN) });
  if (res.status === 404) return [];
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GitHub list failed ${res.status} for ${path}${txt ? `: ${txt}` : ""}`);
  }
  const items = await res.json();
  const files = (items || [])
    .filter((x) => x.type === "file" && /\.json$/i.test(x.name))
    .sort((a, b) => (a.name < b.name ? 1 : -1));
  return typeof limit === "number" ? files.slice(0, limit) : files;
}

async function getJsonFromGitHub({ OWNER, REPO, TOKEN, BRANCH, path }) {
  const url = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${encodeURIComponent(
    BRANCH
  )}/${encPath(path)}`;
  const res = await fetch(url, { headers: ghHeaders(TOKEN) });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ---------- number/time utils ----------
const toNum = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const parseTimeSafe = (v) => {
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : 0;
};

// ---------- order helpers ----------
function orderAmount(o) {
  return toNum(o?.amount) || toNum(o?.custom_amount) || toNum(o?.meta?.amount) || 0;
}
function orderPlannedPasses(o) {
  if ((o?.type || "").toLowerCase() === "bulk") {
    return toNum(o?.meta?.quantity) || toNum(o?.passes) || 0;
  }
  return toNum(o?.passes) || 0;
}
function orderIssuedPasses(o) {
  return (
    toNum(o?.fulfilled?.count) ||
    (Array.isArray(o?.konfhub?.registrations) ? o.konfhub.registrations.length : 0)
  );
}
function effectivePasses(o) {
  // Prefer issued; else planned
  const issued = orderIssuedPasses(o);
  return issued > 0 ? issued : orderPlannedPasses(o);
}
function orderCreatedAt(o) {
  return (
    o?.created_at ||
    o?.created?.at ||
    o?.cashfree?.created_at ||
    o?.cashfree?.order?.created_at ||
    o?.konfhub?.created_at ||
    null
  );
}
function normIssuanceStatus(o) {
  const s = (o?.fulfilled?.status || "").toLowerCase();
  return s === "ok" || s === "partial" || s === "failed" ? s : "pending";
}

// ---------- konfhub helpers ----------
const KH_OK_TYPES = [
  // keep liberal; we only include events from KH_SINGLE_EVENT_IDS
  "registration.created",
  "registration.completed",
  "registration.success",
  "order.completed",
  "payment.succeeded",
  "payment.success",
];

function getEventIdKH(e) {
  return (
    e?.event_id ||
    e?.eventId ||
    e?.event?.id ||
    e?.payload?.event_id ||
    e?.data?.event_id ||
    e?.event ||
    ""
  );
}

function getEventTypeKH(e) {
  return (
    (e?.type || e?.event_type || e?.event || e?.payload?.type || e?.data?.type || "")
      .toString()
      .toLowerCase()
  );
}

function countTicketsKH(e) {
  // Try common shapes: tickets array with quantity, or single qty, else assume 1
  const paths = [
    e?.tickets,
    e?.payload?.tickets,
    e?.data?.tickets,
    e?.registration?.tickets,
    e?.payload?.registration?.tickets,
  ].filter(Boolean);

  for (const t of paths) {
    if (Array.isArray(t)) {
      return t.reduce((sum, it) => sum + (toNum(it?.quantity, 1) || 1), 0);
    }
  }

  const q =
    toNum(e?.quantity) ||
    toNum(e?.payload?.quantity) ||
    toNum(e?.data?.quantity) ||
    toNum(e?.registration?.quantity);
  return q || 1;
}

function getEmailKH(e) {
  return (
    e?.email ||
    e?.payload?.email ||
    e?.data?.email ||
    e?.registration?.email ||
    e?.payload?.registration?.email ||
    ""
  );
}

function getAtKH(e) {
  return e?.at || e?.created_at || e?.received_at || e?.timestamp || null;
}

// ---------- loaders ----------
async function loadOrders(env, limit) {
  const dir = `${env.STORE_PATH}/orders`;
  const files = await listFilesGitHub({
    OWNER: env.OWNER,
    REPO: env.REPO,
    TOKEN: env.TOKEN,
    BRANCH: env.BRANCH,
    path: dir,
    limit: limit * 3,
  });

  const rows = [];
  for (const f of files) {
    const p = `${env.STORE_PATH}/orders/${f.name}`;
    const j = await getJsonFromGitHub({ OWNER: env.OWNER, REPO: env.REPO, TOKEN: env.TOKEN, BRANCH: env.BRANCH, path: p });
    if (j) rows.push(j);
    if (rows.length >= limit * 2) break;
  }
  return rows;
}

async function loadKonfhub(env, limit) {
  const dirs = [`${env.STORE_PATH}/konfhub`, `${env.STORE_PATH}/konfhub/events`];
  const all = [];

  for (const d of dirs) {
    try {
      const part = await listFilesGitHub({
        OWNER: env.OWNER,
        REPO: env.REPO,
        TOKEN: env.TOKEN,
        BRANCH: env.BRANCH,
        path: d,
        limit,
      });
      all.push(...part);
    } catch {
      // ok if directory missing
    }
  }

  const seen = new Set();
  const uniq = all.filter((f) => {
    const k = f.path || f.name;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const rows = [];
  for (const f of uniq.slice(0, limit * 2)) {
    const base = f.path || `${env.STORE_PATH}/konfhub/${f.name}`;
    const j = await getJsonFromGitHub({ OWNER: env.OWNER, REPO: env.REPO, TOKEN: env.TOKEN, BRANCH: env.BRANCH, path: base });
    if (j) rows.push(j);
  }
  return rows;
}

// ---------- main ----------
exports.handler = async (event) => {
  try {
    const env = cfg();

    // auth - accept both 'k' and 'key' query parameters, or 'x-admin-key' header
    const supplied =
      (event.queryStringParameters && (event.queryStringParameters.k || event.queryStringParameters.key)) ||
      event.headers["x-admin-key"] ||
      "";
    if (!env.ADMIN_KEY || supplied !== env.ADMIN_KEY) {
      return json(401, { ok: false, error: "Unauthorized" });
    }
    if (!env.OWNER || !env.REPO) {
      return json(500, { ok: false, error: "GITHUB_OWNER or GITHUB_REPO not configured" });
    }

    const q = event.queryStringParameters || {};
    const limit = Math.max(1, Math.min(200, toNum(q.limit || q.recent || DEFAULT_LIMIT)));

    const [orders, khEvents] = await Promise.all([loadOrders(env, limit), loadKonfhub(env, limit)]);

    // Totals scaffold
    const totals = {
      orders: 0,
      donations: { count: 0, amount: 0, passes: 0 },
      bulk: { count: 0, quantity: 0 },
      issuance: { ok: 0, partial: 0, failed: 0, pending: 0, passes_issued: 0 },
      konfhub_webhooks: { total: 0, by_event: {} },
      // NEW ticket breakdown
      tickets: {
        total: 0,
        single: { registrations: 0, passes: 0 }, // from KH single-event IDs
        donation: { orders: 0, passes: 0 },      // from orders
        bulk: { orders: 0, passes: 0 },          // from orders
      },
    };

    const recent_orders = [];

    // ---- Aggregate orders (donation + bulk; includes issuance summary) ----
    for (const o of orders) {
      totals.orders += 1;

      const typ = (o?.type || "").toLowerCase();
      const amt = orderAmount(o);
      const effPasses = effectivePasses(o);

      if (typ === "donation") {
        totals.donations.count += 1;
        totals.donations.amount += amt;
        totals.donations.passes += effPasses;
        totals.tickets.donation.orders += 1;
        totals.tickets.donation.passes += effPasses;
      } else if (typ === "bulk") {
        totals.bulk.count += 1;
        totals.bulk.quantity += orderPlannedPasses(o);
        totals.tickets.bulk.orders += 1;
        totals.tickets.bulk.passes += effPasses;
      }

      const st = normIssuanceStatus(o);
      totals.issuance[st] += 1;
      totals.issuance.passes_issued += orderIssuedPasses(o);

      recent_orders.push({
        created_at: orderCreatedAt(o),
        type: typ || "order",
        amount: amt,
        passes: effPasses,
        email: o?.email || o?.purchaser_email || o?.buyer?.email || "",
        status: st,
      });
    }

    recent_orders.sort((a, b) => parseTimeSafe(b.created_at) - parseTimeSafe(a.created_at));

    // ---- Aggregate KonfHub events for SINGLE registrations only ----
    const singleEventIds = new Set(env.KH_SINGLE_EVENT_IDS.map((s) => s.toLowerCase()));
    const recent_konfhub = [];

    for (const e of khEvents) {
      totals.konfhub_webhooks.total += 1;

      const typeStr = getEventTypeKH(e);
      const evId = (getEventIdKH(e) || "").toString().toLowerCase();

      totals.konfhub_webhooks.by_event[typeStr] =
        (totals.konfhub_webhooks.by_event[typeStr] || 0) + 1;

      // Count single registrations only for whitelisted event IDs and "success-ish" types
      const isSingleEvent = singleEventIds.size ? singleEventIds.has(evId) : false;
      const looksSuccessful =
        !typeStr || KH_OK_TYPES.some((t) => typeStr.includes(t.replace(".", "")) || typeStr === t);

      if (isSingleEvent && looksSuccessful) {
        const qty = countTicketsKH(e);
        totals.tickets.single.registrations += 1;
        totals.tickets.single.passes += qty;
      }

      recent_konfhub.push({
        at: getAtKH(e),
        event_id: getEventIdKH(e),
        type: typeStr || "event",
        email: getEmailKH(e),
        ticket_id:
          e?.ticket_id ||
          e?.payload?.ticket_id ||
          e?.data?.ticket_id ||
          e?.ticket ||
          "",
      });
    }

    recent_konfhub.sort((a, b) => parseTimeSafe(b.at) - parseTimeSafe(a.at));

    // Final ticket total
    totals.tickets.total =
      totals.tickets.single.passes +
      totals.tickets.donation.passes +
      totals.tickets.bulk.passes;

    return json(200, {
      ok: true,
      totals,
      recent_orders: recent_orders.slice(0, limit),
      recent_konfhub: recent_konfhub.slice(0, limit),
      meta: {
        repo: `${cfg().OWNER}/${cfg().REPO}`,
        branch: cfg().BRANCH,
        store_path: cfg().STORE_PATH,
        single_event_ids: env.KH_SINGLE_EVENT_IDS,
        limit,
      },
    });
  } catch (err) {
    return json(500, { ok: false, error: err.message || String(err) });
  }
};
