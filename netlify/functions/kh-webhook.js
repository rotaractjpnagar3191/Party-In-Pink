// kh-webhook.js — store KonfHub webhooks into storage/konfhub for Ops

const { saveJSON } = require('./_github');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  // Best-effort parse
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { body = { raw: event.body }; }

  // Try to detect fields across possible shapes
  const type =
    body?.event_type || body?.type || body?.action ||
    event.headers['x-kh-event'] || event.headers['x-konfhub-event'] || 'unknown';

  const eventId =
    body?.event_id || body?.eventId || body?.event?.id ||
    body?.event?.event_id || 'unknown';

  const email =
    body?.attendee?.email || body?.user?.email ||
    body?.email || body?.data?.email || null;

  const ticketId =
    body?.ticket_id || body?.ticketId || body?.ticket?.id ||
    body?.data?.ticket_id || 'unknown';

  // File name: time__eventId__type__ticket.json
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const file = `storage/konfhub/${stamp}__${eventId}__${type}__${ticketId}.json`;

  await saveJSON(file, {
    at: new Date().toISOString(),
    headers: event.headers,
    type, event_id: eventId, email, ticket_id: ticketId,
    payload: body
  });

  return { statusCode: 200, body: JSON.stringify({ ok:true }) };
};
