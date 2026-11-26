// Shared by the k6 scripts: the API's address, the seeded users and lookup values, signing in once
// per virtual user, and requests tagged by kind so the thresholds (the SLOs) apply per kind.
import http from 'k6/http'
import { check, fail } from 'k6'
import { SharedArray } from 'k6/data'

export const BASE = __ENV.BASE_URL || 'http://localhost:3100'
// One of the API's allowed origins, for the CSRF check on requests that change something
export const ORIGIN = __ENV.ORIGIN || 'http://localhost:5175'

const DATA = __ENV.DATA_DIR || '../data'
const load = (file) => JSON.parse(open(`${DATA}/${file}`))
const users = load('users.json')
export const PASSWORD = users.password
export const clerks = new SharedArray('clerks', () => users.clerks)
export const accountants = new SharedArray('accountants', () => users.accountants)
export const govtUsers = new SharedArray('govt', () => users.govt)
// The government's 100 people: 5 seniors who follow the dashboard, 95 agents who search and review
export const govtSeniors = new SharedArray('govtSeniors', () => users.govt.slice(0, 5))
export const govtAgents = new SharedArray('govtAgents', () => users.govt.slice(5, 100))
export const validTokens = new SharedArray('valid', () => load('verify.json').valid)
export const expiredTokens = new SharedArray('expired', () => load('verify.json').expired)
const search = load('search.json')
export const searchTerms = new SharedArray('search', () => [
  ...search.billIds,
  ...search.manifestNos,
  ...search.plates,
  ...search.idNumbers.map((id) => id)
])
export const tripIds = new SharedArray('tripIds', () => search.tripIds)
// What agents look up: this week's trips 9 times in 10, older ones otherwise (the seeder writes
// both; an older data file has only the mixed lists)
const recent = search.recent || search
const older = search.older || search
const termsOf = (s) => [...s.billIds, ...s.manifestNos, ...s.tripIds.map((id) => `#${id}`)]
export const recentTerms = new SharedArray('recentTerms', () => termsOf(recent))
export const olderTerms = new SharedArray('olderTerms', () => termsOf(older))
export const recentTripIds = new SharedArray('recentTripIds', () => recent.tripIds)

export const pick = (list) => list[Math.floor(Math.random() * list.length)]

// A client IP per virtual user (the API trusts X-Forwarded-For in the load-test stack), so the
// per-IP limits act as they would for many real browsers
export const vuIp = () => `10.${(__VU >> 16) & 255}.${(__VU >> 8) & 255}.${__VU & 255}`
export const randomIp = () =>
  `100.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`

const headers = (extra = {}) => ({ 'X-Forwarded-For': vuIp(), Origin: ORIGIN, ...extra })

// A JSON request tagged with its kind (read, write, dashboard, export, verify, login) and a stable
// name for the per-endpoint breakdown; fails the check unless the API answered ok
export function api(method, path, { kind, name, body, ip, expect = 'ok', timeout = '60s' }) {
  const params = {
    headers: headers(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    tags: { kind, name: name || `${method} ${path}` },
    timeout
  }
  if (ip) params.headers['X-Forwarded-For'] = ip
  const res = http.request(
    method,
    `${BASE}${path}`,
    body === undefined ? null : JSON.stringify(body),
    params
  )
  if (expect === 'raw') {
    check(res, { [`${params.tags.name} 200`]: (r) => r.status === 200 })
    return res
  }
  let json = null
  try {
    json = res.json()
  } catch {
    // not JSON: the check below fails
  }
  // A queued export answers 202
  const okStatus = expect === 'queued' ? 202 : 200
  check(res, {
    [`${params.tags.name} ok`]: () => res.status === okStatus && json && json.ok === true
  })
  return json && json.ok ? (json.data ?? json) : null
}

// A multipart upload (an attachment), tagged as a write
export function upload(docType, file) {
  const res = http.post(
    `${BASE}/documents`,
    { docType, file },
    { headers: headers(), tags: { kind: 'write', name: 'POST /documents' }, timeout: '60s' }
  )
  let json = null
  try {
    json = res.json()
  } catch {
    // checked below
  }
  check(res, { 'POST /documents ok': () => res.status === 200 && json && json.ok === true })
  return json && json.ok ? json.data : null
}

// Signs this virtual user in once (each VU has its own cookie jar); later iterations reuse it
let signedInAs = null
export function signIn(list) {
  const username = list[(__VU - 1) % list.length]
  if (signedInAs === username) return true
  const res = http.post(`${BASE}/auth/login`, JSON.stringify({ username, password: PASSWORD }), {
    headers: headers({ 'Content-Type': 'application/json' }),
    tags: { kind: 'login', name: 'POST /auth/login' }
  })
  const ok = check(res, { 'POST /auth/login ok': (r) => r.status === 200 && r.json('ok') === true })
  if (ok) signedInAs = username
  return ok
}

// The SLOs, per kind of request, plus every endpoint's p95 in the summary (those always pass)
const ENDPOINTS = [
  'POST /auth/login',
  'GET /auth/me',
  'GET /trips/reference',
  'GET /trips/suggestions',
  'GET /vehicles',
  'GET /drivers',
  'GET /trips',
  'GET /trips?search',
  'GET /trips/:id',
  'POST /trips',
  'POST /documents',
  'POST /trips/:id/bill',
  'POST /trips/:id/simulate-payment',
  'POST /trips/:id/refresh',
  'POST /govt/dashboard',
  'POST /govt/dashboard/history',
  'POST /govt/dashboard/today',
  'GET /govt/documents/:id/file',
  'GET /govt/search',
  'GET /govt/trips/:id',
  'POST /govt/exports',
  'GET /govt/exports/:id',
  'GET /govt/exports/:id/file',
  'GET /verify/:token'
]
export const thresholds = {
  http_req_failed: ['rate<0.001'],
  // An arrival-rate run that couldn't start its iterations on time (no VU free) didn't send the
  // load it claims: no iteration may be dropped
  dropped_iterations: ['count==0'],
  checks: ['rate>0.999'],
  'http_req_duration{kind:read}': ['p(95)<500'],
  'http_req_duration{kind:write}': ['p(95)<1000'],
  'http_req_duration{kind:login}': ['p(95)<1000'],
  'http_req_duration{kind:verify}': ['p(95)<300'],
  'http_req_duration{kind:dashboard}': ['p(95)<3000'],
  // Queuing an export and downloading its file; the wait in between is export_job_ms
  'http_req_duration{kind:export}': ['p(95)<15000'],
  // A month of national trips and bills as Excel, queued to downloaded
  export_job_ms: ['p(95)<900000'],
  ...Object.fromEntries(
    ENDPOINTS.map((name) => [`http_req_duration{name:${name}}`, ['p(95)<600000']])
  )
}

export function mustHave(value, what) {
  if (!value) fail(`no ${what}`)
  return value
}
