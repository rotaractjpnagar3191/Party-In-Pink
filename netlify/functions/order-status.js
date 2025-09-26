const { getConfig } = require('./_config');
const { getJson } = require('./_github');

exports.handler = async (event) => {
  const id = new URL(event.rawUrl).searchParams.get('id');
  if (!id) return { statusCode: 400, body: 'Missing id' };

  const { private: ENV } = getConfig();
  const path = `${ENV.STORE_PATH}/orders/${id}.json`;
  const oc = await getJson(ENV, path);
  if (!oc) return { statusCode: 404, body: 'Not found' };

  // Redact secrets
  const safe = { ...oc };
  delete safe.cashfree?.order?.payment_link;
  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(safe) };
};
