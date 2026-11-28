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

// The accounts the run's virtual users sign in as (signIn picks list[(__VU - 1) % length]), signed
// in by setup() before the measured run starts, 16 at a time: had every VU signed in on its first
// iteration, the run's first seconds would be a sign-in storm no real shift has (all of them at
// once), which both slowed everything else and dropped iterations. Tagged `session` (reported,
// no target); the login flow is the sign-in rush, at its agreed rate. Returns username → session.
export function signInAll(vus) {
  const names = new Set()
  for (const list of [clerks, accountants, govtSeniors, govtAgents, govtUsers]) {
    for (let i = 0; i < Math.min(vus, list.length); i++) names.add(list[i])
  }
  const all = [...names]
  const sessions = {}
  const started = Date.now()
  for (let i = 0; i < all.length; i += 16) {
    const batch = all.slice(i, i + 16)
    const replies = http.batch(
      batch.map((username, j) => ({
        method: 'POST',
        url: `${BASE}/auth/login`,
        body: JSON.stringify({ username, password: PASSWORD }),
        params: {
          headers: {
            'Content-Type': 'application/json',
            Origin: ORIGIN,
            'X-Forwarded-For': `10.250.${(i + j) >> 8}.${(i + j) & 255}`
          },
          tags: { kind: 'session', name: 'POST /auth/login (session start)' },
          // Each its own jar: a sign-in that sent the previous one's cookie would end that
          // session (the API replaces a session the browser already had)
          jar: new http.CookieJar()
        }
      }))
    )
    replies.forEach((res, j) => {
      const cookie = res.cookies[SESSION_COOKIE]
      if (res.status === 200 && cookie && cookie.length) sessions[batch[j]] = cookie[0].value
    })
  }
  const seconds = (Date.now() - started) / 1000
  console.log(
    `setup: ${Object.keys(sessions).length} / ${all.length} sessions in ${seconds.toFixed(1)} s ` +
      `(${(all.length / seconds).toFixed(1)} sign-ins a second, 16 at a time)`
  )
  return sessions
}

const SESSION_COOKIE = 'masarat_session'

// This virtual user's session (each VU has its own cookie jar): the one setup() made for its
// account, or a sign-in of its own on its first iteration (a run without setup's sessions); later
// iterations reuse it
let signedInAs = null
export function signIn(list, data) {
  const username = list[(__VU - 1) % list.length]
  if (signedInAs === username) return true
  const session = data && data.sessions && data.sessions[username]
  if (session) {
    http.cookieJar().set(BASE, SESSION_COOKIE, session, { path: '/' })
    signedInAs = username
    return true
  }
  const res = http.post(`${BASE}/auth/login`, JSON.stringify({ username, password: PASSWORD }), {
    headers: headers({ 'Content-Type': 'application/json' }),
    tags: { kind: 'session', name: 'POST /auth/login (session start)' }
  })
  const ok = check(res, { 'POST /auth/login ok': (r) => r.status === 200 && r.json('ok') === true })
  if (ok) signedInAs = username
  return ok
}

// The SLOs, per kind of request, plus every endpoint's p95 in the summary (those always pass)
const ENDPOINTS = [
  'POST /auth/login',
  'POST /auth/login (session start)',
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
  // The exports' share of them, so a run where only the export worker fell behind tells itself
  // apart (loadtest/run.sh: EXPORT-ONLY)
  'dropped_iterations{scenario:exportData}': ['count==0'],
  checks: ['rate>0.999'],
  'http_req_duration{kind:read}': ['p(95)<500'],
  'http_req_duration{kind:write}': ['p(95)<1000'],
  'http_req_duration{kind:login}': ['p(95)<1000'],
  // Reported, no target (signInAll), and counted, so the measured rate can leave setup's
  // sign-ins out (http_reqs' rate covers setup too)
  'http_req_duration{kind:session}': ['p(95)<600000'],
  'http_reqs{kind:session}': ['count>=0'],
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
