// Serverless function: bulk capture via KonfHub for hidden complimentary ticket
const CHUNK = 20;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, body: 'Method Not Allowed' };

  // simple guard
  const key =
    event.headers['x-admin-key'] ||
    event.headers['X-Admin-Key'] ||
    (() => { try { return JSON.parse(event.body || '{}').admin_key } catch { return '' } })();

  if (process.env.ADMIN_KEY && key !== process.env.ADMIN_KEY)
    return { statusCode: 401, body: 'Unauthorized' };

  for (const k of ['KONFHUB_API_KEY','KONFHUB_EVENT_ID','KONFHUB_BULK_TICKET_ID']) {
    if (!process.env[k]) return { statusCode: 500, body: `Missing server env: ${k}` };
  }

  try{
    const { sponsor, upi_ref, attendees = [] } = JSON.parse(event.body || '{}');
    if (!Array.isArray(attendees) || attendees.length === 0)
      return { statusCode: 400, body: 'No attendees' };

    const EVENT_ID = process.env.KONFHUB_EVENT_ID;
    const TICKET_ID = String(process.env.KONFHUB_BULK_TICKET_ID);
    const CF_ROT = process.env.KONFHUB_CF_ROTARACTOR || ''; // radio Yes/No
    const CF_CLUB = process.env.KONFHUB_CF_CLUB || '';       // text

    const map = (a) => {
      const cf = {};
      if (CF_ROT) cf[CF_ROT] = (/^y/i.test(String(a.rotaractor||'')) ? 'Yes' : 'No');
      if (CF_CLUB && a.club) cf[CF_CLUB] = a.club;

      const o = {
        name: a.name,
        email_id: a.email,
        dial_code: a.dial_code || '+91',
        country_code: a.country_code || 'in',
        phone_number: String(a.phone||'').replace(/\D/g,'')
      };
      if (Object.keys(cf).length) o.custom_forms = cf;
      return o;
    };

    // chunk and send
    const chunks = [];
    for (let i=0;i<attendees.length;i+=CHUNK) chunks.push(attendees.slice(i,i+CHUNK));

    const results = [];
    for (const c of chunks){
      const payload = {
        event_id: EVENT_ID,
        registration_tz: 'Asia/Kolkata',
        registration_details: { [TICKET_ID]: c.map(map) }
      };

      // ✅ KonfHub API call with timeout (15s)
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), 15000); // 15 second timeout for KonfHub

      try {
        const r = await fetch('https://api.konfhub.com/event/capture/v2', {
          method:'POST',
          headers:{
            'x-api-key': process.env.KONFHUB_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload),
          signal: abortController.signal
        });

        const text = await r.text();
        if (!r.ok) return { statusCode: r.status, body: text };
        results.push(text);
      } catch (err) {
        if (err.name === 'AbortError') {
          console.error('[konfhub-capture-bulk] ❌ KonfHub timeout - batch size:', c.length);
          return { statusCode: 504, body: 'KonfHub service timeout' };
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }

      await new Promise(res => setTimeout(res, 1000)); // gentle throttle
    }

    // You can log {sponsor, upi_ref, attendees.length} to your storage here if needed.

    return { statusCode: 200, body: JSON.stringify({ ok:true, batches: results.length, total: attendees.length }) };
  }catch(e){
    return { statusCode: 500, body: `Server error: ${e.message || e}` };
  }
};
