// Simple GitHub Contents API helpers for JSON ledger
async function getJson(env, path){
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = env;
  if (!GITHUB_TOKEN) {
    console.error('[_github.getJson] ERROR: GITHUB_TOKEN not set');
    return null;
  }
  if (!GITHUB_OWNER || !GITHUB_REPO) {
    console.error('[_github.getJson] ERROR: GITHUB_OWNER or GITHUB_REPO not set');
    return null;
  }
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(path)}`;
  console.log('[_github.getJson] Fetching from:', url);
  const r = await fetch(url, { headers:{ Authorization:`Bearer ${GITHUB_TOKEN}`, 'user-agent':'pip-netlify' } });
  if (!r.ok) {
    console.warn('[_github.getJson] Request failed:', r.status, r.statusText);
    return null;
  }
  const j = await r.json();
  console.log('[_github.getJson] Success, found file with sha:', j.sha?.slice(0,8));
  return JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
}

async function putJson(env, path, data){
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH='main' } = env;
  
  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN not set');
  if (!GITHUB_OWNER || !GITHUB_REPO) throw new Error('GITHUB_OWNER or GITHUB_REPO not set');
  
  const api = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(path)}`;
  console.log('[_github.putJson] Saving to:', api);
  
  const get = await fetch(api, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'user-agent':'pip-netlify' } });
  const exists = get.ok ? (await get.json()) : null;
  
  if (exists) {
    console.log('[_github.putJson] File exists, sha:', exists.sha?.slice(0,8));
  } else {
    console.log('[_github.putJson] File does not exist, will create');
  }
  
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const payload = { message:`store ${path}`, content, branch:GITHUB_BRANCH };
  if (exists?.sha) payload.sha = exists.sha;
  
  console.log('[_github.putJson] Payload size:', JSON.stringify(payload).length, 'bytes');
  
  const res = await fetch(api, { method:'PUT', headers:{ Authorization:`Bearer ${GITHUB_TOKEN}`, 'content-type':'application/json' }, body:JSON.stringify(payload) });
  
  if (!res.ok) {
    const errText = await res.text();
    console.error('[_github.putJson] GitHub API error:', res.status, res.statusText);
    console.error('[_github.putJson] Response:', errText);
    throw new Error(`GitHub store failed: ${res.status} ${res.statusText}`);
  }
  
  console.log('[_github.putJson] ✓ Successfully saved');
}
module.exports = { getJson, putJson };
