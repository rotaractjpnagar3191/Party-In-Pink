const { getConfig } = require('./_config');
const { getJson, putJson } = require('./_github');
const { issueComplimentaryPasses } = require('./_konfhub');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  const { private: ENV } = getConfig();
  if ((event.headers['x-admin-key'] || '') !== (process.env.ADMIN_KEY || '')) {
    return { statusCode: 401, body: 'Unauthorized' };
  }
  const { id } = JSON.parse(event.body || '{}');
  if (!id) return { statusCode: 400, body: 'Missing id' };

  const path = `${ENV.STORE_PATH}/orders/${id}.json`;
  const oc = await getJson(ENV, path);
  if (!oc) return { statusCode: 404, body: 'Not found' };

  const issued = await issueComplimentaryPasses(ENV, oc);
  oc.konfhub = { ticket_id_used: oc.type==='bulk' ? ENV.KONFHUB_BULK_TICKET_ID || ENV.KONFHUB_FREE_TICKET_ID : ENV.KONFHUB_FREE_TICKET_ID, registrations: issued.created };
  oc.fulfilled = { at: new Date().toISOString(), status: issued.errors?.length ? 'partial' : 'ok', count: issued.total };
  if (issued.errors?.length) oc.issuance_errors = issued.errors;
  await putJson(ENV, path, oc);

  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true, issued }) };
};
