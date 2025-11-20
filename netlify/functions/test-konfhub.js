// Simple test endpoint to verify KonfHub API works

const https = require('https');

function getenv(env, key) {
  return (env && env[key] != null ? env[key] : process.env[key]) || null;
}

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

exports.handler = async (event) => {
  try {
    const apiKey = process.env.KONFHUB_API_KEY;
    const eventId = process.env.KONFHUB_EVENT_ID_INTERNAL;
    const ticketId = process.env.KONFHUB_INTERNAL_FREE_TICKET_ID;
    const accessCode = process.env.KONFHUB_ACCESS_CODE_FREE;

    console.log('[test-konfhub] Testing KonfHub API');
    console.log('[test-konfhub] API Key:', apiKey ? '***' : 'MISSING');
    console.log('[test-konfhub] Event ID:', eventId);
    console.log('[test-konfhub] Ticket ID:', ticketId);
    console.log('[test-konfhub] Access Code:', accessCode);

    if (!apiKey || !eventId || !ticketId) {
      return { 
        statusCode: 400, 
        body: JSON.stringify({ error: 'Missing KonfHub credentials' }) 
      };
    }

    // Test with a single dummy attendee
    const payload = {
      event_id: eventId,
      registration_tz: 'Asia/Kolkata',
      registration_details: {
        [ticketId]: [
          {
            name: 'Test Person',
            email_id: 'test@example.com',
            dial_code: '+91',
            country_code: 'in',
            phone_number: '9876543210'
          }
        ]
      }
    };

    const headers = {
      'x-api-key': apiKey,
      'content-type': 'application/json'
    };
    if (accessCode) headers['x-access-code'] = accessCode;

    console.log('[test-konfhub] Sending request to KonfHub...');
    const result = await postJSON(
      'https://api.konfhub.com/event/capture/v2',
      headers,
      JSON.stringify(payload)
    );

    console.log('[test-konfhub] Response:', { ok: result.ok, status: result.status, json: result.json });

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: result.ok,
        status: result.status,
        response: result.json
      })
    };
  } catch (err) {
    console.error('[test-konfhub] ERROR:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
