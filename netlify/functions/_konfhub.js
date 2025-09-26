// KonfHub issuance via Capture API v2 (registration_details)
// - No external deps: uses built-in https
// - 20-per-call chunking
// - Optional access codes sent via header: x-access-code
// - Attendee name: donor/contact (or derived from email)

const https = require('https');

function getenv(env, key) {
  return (env && env[key] != null ? env[key] : process.env[key]) || null;
}

function niceNameFromEmail(email) {
  if (!email) return 'Guest';
  const local = String(email).split('@')[0];
  return local.replace(/[\.\_\-]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}
function attendeeName(order, email, i) {
  const base = (order?.name && order.name.trim()) || niceNameFromEmail(email);
  return (order?.type === 'donation' && (order?.recipients || []).length > 1)
    ? `${base} #${i + 1}` : base;
}

function buildPeople(order) {
  const recipients = Array.isArray(order?.recipients) && order.recipients.length
    ? order.recipients
    : [order?.email];

  const total = Math.max(0, Number(order?.passes || 0));
  const people = [];

  for (let i = 0; i < total; i++) {
    const email = String(recipients[i % recipients.length] || '').trim().toLowerCase();
    people.push({
      name: attendeeName(order, email, i),
      email_id: email,
      dial_code: '+91',
      country_code: 'in',
      phone_number: String(order?.phone || '').replace(/\D/g, ''),
    });
  }
  return people;
}

function isTicketInaccessible(resp, status) {
  const code = resp?.error?.error_code || resp?.error_code || '';
  const msg  = (resp?.error?.error_message || resp?.error_message || resp?.raw || '').toString();
  return code === 'ASC-20' || /ticket is not accessible/i.test(msg) || status === 403;
}

/** tiny https JSON POST helper */
function postJSON(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      headers: Object.assign({}, headers, {
        'content-length': Buffer.byteLength(body),
      }),
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => raw += c);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(raw); } catch { json = { raw }; }
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function capture(env, ticketId, chunk, eventId, accessCode) {
  const payload = {
    event_id: eventId,
    registration_tz: 'Asia/Kolkata',
    registration_details: { [ticketId]: chunk }
  };

  const headers = {
    'x-api-key': getenv(env, 'KONFHUB_API_KEY'),
    'content-type': 'application/json'
  };
  if (accessCode) headers['x-access-code'] = accessCode;

  return await postJSON('https://api.konfhub.com/event/capture/v2', headers, JSON.stringify(payload));
}

function accessCodes(env, type) {
  const codeBulk = (getenv(env, 'KONFHUB_ACCESS_CODE_BULK') || '').trim();
  const codeFree = (getenv(env, 'KONFHUB_ACCESS_CODE_FREE') || '').trim();
  return type === 'bulk' ? { primary: codeBulk || null, fallback: codeFree || null }
                         : { primary: codeFree || null, fallback: codeFree || null };
}

async function issueComplimentaryPasses(env, oc) {
  if (!getenv(env, 'KONFHUB_API_KEY')) throw new Error('KonfHub API key missing');

  const EVENT_ID =
    getenv(env, 'KONFHUB_EVENT_ID_INTERNAL') ||
    getenv(env, 'KONFHUB_EVENT_ID');

  const PRIMARY_ID =
    oc.type === 'bulk'
      ? (getenv(env, 'KONFHUB_INTERNAL_BULK_TICKET_ID') ||
         getenv(env, 'KONFHUB_BULK_TICKET_ID') ||
         getenv(env, 'KONFHUB_FREE_TICKET_ID'))
      : (getenv(env, 'KONFHUB_INTERNAL_FREE_TICKET_ID') ||
         getenv(env, 'KONFHUB_FREE_TICKET_ID'));

  const FALLBACK_ID =
    (getenv(env, 'KONFHUB_INTERNAL_FREE_TICKET_ID') || getenv(env, 'KONFHUB_FREE_TICKET_ID')) &&
    (getenv(env, 'KONFHUB_INTERNAL_FREE_TICKET_ID') || getenv(env, 'KONFHUB_FREE_TICKET_ID')) !== PRIMARY_ID
      ? (getenv(env, 'KONFHUB_INTERNAL_FREE_TICKET_ID') || getenv(env, 'KONFHUB_FREE_TICKET_ID'))
      : null;

  if (!EVENT_ID)   throw new Error('KonfHub event id (internal) missing');
  if (!PRIMARY_ID) throw new Error('KonfHub complimentary ticket id (internal) missing');

  const { primary: codePrimary, fallback: codeFallback } = accessCodes(env, oc.type);
  const people = buildPeople(oc);

  const limit = 20;
  const created = [];
  const errors  = [];
  const ticketsUsed = new Set();

  for (let start = 0; start < people.length; start += limit) {
    const group = people.slice(start, start + limit);

    const first = await capture(env, PRIMARY_ID, group, EVENT_ID, codePrimary);
    if (first.ok) {
      ticketsUsed.add(PRIMARY_ID);
      created.push({ start, count: group.length, ticket_id: PRIMARY_ID, response: first.json });
      continue;
    }

    if (isTicketInaccessible(first.json, first.status) && FALLBACK_ID) {
      const second = await capture(env, FALLBACK_ID, group, EVENT_ID, codeFallback);
      if (second.ok) {
        ticketsUsed.add(FALLBACK_ID);
        created.push({ start, count: group.length, ticket_id: FALLBACK_ID, response: second.json });
        continue;
      }
      errors.push({ start, count: group.length, ticket_id: FALLBACK_ID, error: second.json, status: second.status, tried_fallback: true });
      continue;
    }

    errors.push({ start, count: group.length, ticket_id: PRIMARY_ID, error: first.json, status: first.status });
  }

  return { total: people.length, created, errors, tickets_used: Array.from(ticketsUsed) };
}

module.exports = { issueComplimentaryPasses };
