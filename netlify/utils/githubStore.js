// Append-only JSONL storage in a private GitHub repo
const API = 'https://api.github.com'
const OWNER = process.env.GITHUB_OWNER
const REPO = process.env.GITHUB_REPO
const BRANCH = process.env.GITHUB_BRANCH || 'main'
const TOKEN = process.env.GITHUB_TOKEN
const STORE_PATH = process.env.STORE_PATH || 'storage'

async function gh(path, opts={}) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
    ...(opts.headers||{})
  }
  const res = await fetch(`${API}${path}`, { ...opts, headers })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(()=>res.statusText)}`)
  return res.json()
}

async function getFile(p) {
  const data = await gh(`/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(p)}?ref=${encodeURIComponent(BRANCH)}`)
  if (!data) return null
  const buf = Buffer.from(data.content || '', 'base64')
  return { text: buf.toString('utf-8'), sha: data.sha }
}

async function putFile(p, text, message, sha=null) {
  return gh(`/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(p)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: Buffer.from(text, 'utf-8').toString('base64'),
      branch: BRANCH,
      ...(sha ? { sha } : {})
    })
  })
}

async function ensureFile(p, initial='') {
  const f = await getFile(p)
  if (!f) { await putFile(p, initial, `init ${p}`); return { text: initial, sha: null } }
  return f
}

async function appendJSONL(rel, obj) {
  const full = `${STORE_PATH}/${rel}`
  const f = await ensureFile(full, '')
  const next = (f.text || '') + JSON.stringify(obj) + '\n'
  await putFile(full, next, `append ${rel}`, f.sha)
}

async function readJSONL(rel) {
  const full = `${STORE_PATH}/${rel}`
  const f = await getFile(full)
  if (!f?.text) return []
  return f.text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

module.exports = { appendJSONL, readJSONL }
