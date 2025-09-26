// netlify/functions/admin-stats.js
// Aggregates data from the GitHub ledger for the /ops dashboard.
// Auth: x-admin-key header OR ?k= query param must match ADMIN_KEY

const { Octokit } = require("@octokit/rest");

const ENV = (k, d=null) => process.env[k] ?? d;
const ok  = (b) => ({ statusCode: 200, body: JSON.stringify(b) });
const err = (c, m) => ({ statusCode: c, body: JSON.stringify({ ok:false, error:m }) });

function gh() { return new Octokit({ auth: ENV("GITHUB_TOKEN") }); }

function getAdminKey(event) {
  const hkey = event.headers?.["x-admin-key"];
  if (hkey) return hkey;
  const q = event.queryStringParameters || {};
  if (q.k) return q.k;
  if (q.key) return q.key;
  return null;
}

// GitHub list helper (returns [] if path missing)
async function safeListFiles(owner, repo, branch, path) {
  try {
    const res = await gh().repos.getContent({ owner, repo, ref: branch, path });
    const arr = Array.isArray(res.data) ? res.data : [];
    return arr.filter(x => x.type === "file" && x.name.endsWith(".json"))
              .sort((a,b) => b.name.localeCompare(a.name));
  } catch (e) {
    if (e.status === 404) return []; // folder not found
    throw e;
  }
}

async function listMany(owner, repo, branch, paths) {
  const seen = new Set();
  const files = [];
  for (const p of paths) {
    const items = await safeListFiles(owner, repo, branch, p);
    for (const it of items) {
      if (!seen.has(it.path)) { seen.add(it.path); files.push(it); }
    }
  }
  files.sort((a,b)=> b.name.localeCompare(a.name));
  return files;
}

async function readJson(owner, repo, branch, file) {
  const r = await gh().repos.getContent({ owner, repo, ref: branch, path: file.path });
  const raw = Buffer.from(r.data.content, "base64").toString("utf8");
  try { return JSON.parse(raw); } catch { return { raw }; }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") return err(405, "Method not allowed");

    const provided = getAdminKey(event);
    const expected = ENV("ADMIN_KEY");
    if (!expected) return err(500, "ADMIN_KEY not set in env");
    if (provided !== expected) return err(401, "Unauthorized");

    const owner  = ENV("GITHUB_OWNER");
    const repo   = ENV("GITHUB_REPO");
    const branch = ENV("GITHUB_BRANCH", "main");
    const store  = ENV("STORE_PATH", "storage");

    // Candidate locations: slash and dot styles
    const ORDER_DIRS = [
      `${store}/orders`,
      `${store}.orders`,
      `storage/orders`,
      `storage.orders`
    ];
    const KH_DIRS = [
      `${store}/konfhub`,
      `${store}.konfhub`,
      `storage/konfhub`,
      `storage.konfhub`
    ];

    // --- Orders
    const orderFiles = await listMany(owner, repo, branch, ORDER_DIRS);
    const orders = [];
    for (const f of orderFiles.slice(0, 800)) {
      const j = await readJson(owner, repo, branch, f);
      j.__file = f.path;
      orders.push(j);
    }

    let donationCount=0, donationAmount=0, donationPasses=0;
    let bulkCount=0, bulkQty=0;
    let statusOk=0, statusPartial=0, statusFailed=0, statusPending=0;
    let passesIssued=0;

    const recentOrders = [];
    for (const o of orders) {
      const t  = o.type;
      const st = o.fulfilled?.status || "pending";

      if (t === "donation") {
        donationCount++;
        donationAmount += Number(o.amount || 0);
        donationPasses += Number(o.passes || 0);
      } else if (t === "bulk") {
        bulkCount++;
        bulkQty += Number(o.passes || o.meta?.quantity || 0);
      }

      if (st === "ok") statusOk++;
      else if (st === "partial") statusPartial++;
      else if (st === "failed") statusFailed++;
      else statusPending++;

      if (o.fulfilled?.count != null) passesIssued += Number(o.fulfilled.count || 0);

      recentOrders.push({
        id: o.order_id,
        type: o.type,
        email: o.email,
        amount: o.amount || 0,
        passes: o.passes || 0,
        created_at: o.created_at,
        status: st
      });
    }

    // --- KonfHub webhooks
    const khFiles = await listMany(owner, repo, branch, KH_DIRS);
    let khCount=0, khByEvent={}, khRecent=[];
    for (const f of khFiles.slice(0, 800)) {
      const j = await readJson(owner, repo, branch, f);
      khCount++;
      const ev = (j.data?.event_id || j.data?.eventId || "unknown").toString();
      khByEvent[ev] = (khByEvent[ev] || 0) + 1;
      khRecent.push({
        file: f.path,
        at: j.received_at,
        event_id: ev,
        type: (j.data?.type || j.data?.event_type || "unknown").toString(),
        email: j.data?.email || j.data?.email_id || j.data?.attendee?.email_id || null,
        ticket_id: j.data?.ticket_id || j.data?.ticketId || null
      });
    }
    khRecent.sort((a,b)=> (b.at || "").localeCompare(a.at || ""));
    khRecent = khRecent.slice(0, 25);

    recentOrders.sort((a,b)=> (b.created_at || "").localeCompare(a.created_at || ""));
    const recent = recentOrders.slice(0, 25);

    // Optional debug view
    const debug = {};
    if ((event.queryStringParameters || {}).debug === "1") {
      debug.paths = { store, ORDER_DIRS, KH_DIRS };
      debug.counts = { orderFiles: orderFiles.length, khFiles: khFiles.length };
      debug.firstOrderFile = orderFiles[0]?.path || null;
      debug.firstKHFile = khFiles[0]?.path || null;
      debug.branch = branch;
      debug.repo = `${owner}/${repo}`;
    }

    return ok({
      ok: true,
      updated_at: new Date().toISOString(),
      totals: {
        orders: orders.length,
        donations: { count: donationCount, amount: Math.round(donationAmount), passes: donationPasses },
        bulk:     { count: bulkCount, quantity: bulkQty },
        issuance: { ok: statusOk, partial: statusPartial, failed: statusFailed, pending: statusPending, passes_issued: passesIssued },
        konfhub_webhooks: { total: khCount, by_event: khByEvent }
      },
      recent_orders: recent,
      recent_konfhub: khRecent,
      debug
    });
  } catch (e) {
    console.error("admin-stats error", e);
    return err(500, e.message);
  }
};
