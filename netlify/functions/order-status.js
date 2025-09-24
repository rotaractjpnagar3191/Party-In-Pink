const { readJSONL } = require("../utils/githubStore");
exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const ref = qs.ref || qs.order_id;
  if (!ref) return { statusCode: 400, body: "ref required" };
  const pays = await readJSONL("payments.jsonl");
  const paid = pays.some((p) => p.ref === ref);
  return {
    statusCode: 200,
    body: JSON.stringify({ status: paid ? "PAID" : "PENDING" }),
  };
};
