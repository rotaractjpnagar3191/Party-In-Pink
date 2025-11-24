const { getConfig } = require('./_config');
const { sendMail, emailTemplates } = require('./_mail');

exports.handler = async (event) => {
  try {
    // Protect with ADMIN_KEY (same pattern as admin endpoints)
    const supplied =
      (event.queryStringParameters && (event.queryStringParameters.k || event.queryStringParameters.key)) ||
      event.headers['x-admin-key'] ||
      event.headers['X-Admin-Key'] || '';

    const ADMIN_KEY = process.env.ADMIN_KEY || process.env.OPS_ADMIN_KEY || '';
    if (!ADMIN_KEY || supplied !== ADMIN_KEY) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
    }

    const to = (event.queryStringParameters && event.queryStringParameters.to) || process.env.TEST_EMAIL_TO;
    if (!to) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing ?to=<email> or set TEST_EMAIL_TO in env' }) };
    }

    const CFG = getConfig();
    const ENV = CFG.private;

    const templates = emailTemplates();
    const { subject, html, text } = templates.donorThanks({ amount: 1000 });

    const res = await sendMail(ENV, { to, subject: 'PiP SMTP Test — ' + subject, html, text });

    return { statusCode: 200, body: JSON.stringify({ ok: true, result: res }) };
  } catch (e) {
    console.error('[test-email] Error:', e);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message || String(e) }) };
  }
};
