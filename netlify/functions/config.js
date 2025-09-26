const { getConfig } = require('./_config');

exports.handler = async () => {
  const { public: pub } = getConfig();
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(pub)
  };
};
