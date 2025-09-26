// Simple GitHub Contents API helpers for JSON ledger
async function getJson(env, path){
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = env;
  if (!GITHUB_TOKEN) return null;
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(path)}`;
  const r = await fetch(url, { headers:{ Authorization:`Bearer ${GITHUB_TOKEN}`, 'user-agent':'pip-netlify' } });
  if (!r.ok) return null;
  const j = await r.json();
  return JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
}
async function putJson(env, path, data){
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH='main' } = env;
  const api = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(path)}`;
  const get = await fetch(api, { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'user-agent':'pip-netlify' } });
  const exists = get.ok ? (await get.json()) : null;
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  const payload = { message:`store ${path}`, content, branch:GITHUB_BRANCH };
  if (exists?.sha) payload.sha = exists.sha;
  const res = await fetch(api, { method:'PUT', headers:{ Authorization:`Bearer ${GITHUB_TOKEN}`, 'content-type':'application/json' }, body:JSON.stringify(payload) });
  if (!res.ok) throw new Error(`GitHub store failed: ${res.status}`);
}
module.exports = { getJson, putJson };
