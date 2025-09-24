const GITHUB_API = 'https://api.github.com'

function env(name, def=''){
  const v = process.env[name]
  return (v === undefined || v === null || v === '') ? def : v
}

const OWNER = env('GITHUB_OWNER')
const REPO = env('GITHUB_REPO')
const BRANCH = env('GITHUB_BRANCH', 'main')
const TOKEN = env('GITHUB_TOKEN')
const STORE_PATH = env('STORE_PATH', 'storage')

async function gh(path, opts={}){
  const headers = Object.assign({
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28'
  }, opts.headers||{})
  const res = await fetch(`${GITHUB_API}${path}`, Object.assign({}, opts, { headers }))
  if(res.status === 404) return null
  if(!res.ok){
    const t = await res.text().catch(()=>res.statusText)
    throw new Error(`GitHub API ${res.status}: ${t}`)
  }
  return res.json()
}

async function getFile(path){
  const data = await gh(`/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(BRANCH)}`)
  if(!data) return null
  const buff = Buffer.from(data.content || '', 'base64')
  return { text: buff.toString('utf-8'), sha: data.sha }
}

async function putFile(path, text, message, sha=null){
  const body = {
    message,
    content: Buffer.from(text, 'utf-8').toString('base64'),
    branch: BRANCH
  }
  if(sha) body.sha = sha
  const data = await gh(`/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  return data
}

async function ensureFile(path, initial=''){
  const f = await getFile(path)
  if(!f){
    await putFile(path, initial, `init ${path}`)
    return { text: initial, sha: null }
  }
  return f
}

async function appendJSONL(path, obj){
  const full = `${STORE_PATH}/${path}`
  const f = await ensureFile(full, '')
  const text = (f.text || '')
  const line = JSON.stringify(obj) + '\n'
  const next = text + line
  const updated = await putFile(full, next, `append ${path}`, f.sha)
  return updated
}

async function readJSONL(path){
  const full = `${STORE_PATH}/${path}`
  const f = await getFile(full)
  if(!f || !f.text) return []
  const lines = f.text.split('\n').filter(s => s.trim().length > 0)
  return lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

module.exports = { appendJSONL, readJSONL }
