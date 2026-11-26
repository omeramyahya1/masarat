// What each kind of user does, one iteration at a time. The rates are set by the scenario files.
import { check, sleep } from 'k6'
import http from 'k6/http'
import {
  BASE,
  ORIGIN,
  PASSWORD,
  accountants,
  api,
  clerks,
  expiredTokens,
  govtAgents,
  govtSeniors,
  govtUsers,
  olderTerms,
  recentTerms,
  recentTripIds,
  mustHave,
  pick,
  randomIp,
  signIn,
  upload,
  validTokens
} from './lib.js'

// A 1 MB PDF (the API checks the first bytes), made once per VU
const PDF_BYTES = 1024 * 1024
const pdf = (() => {
  const bytes = new Uint8Array(PDF_BYTES)
  const header = '%PDF-1.4\n'
  for (let i = 0; i < header.length; i++) bytes[i] = header.charCodeAt(i)
  for (let i = header.length; i < PDF_BYTES; i++) bytes[i] = 32 + (i % 90)
  return bytes.buffer
})()

// Sudan time (UTC+2, no daylight saving), as the trip form sends it: YYYY-MM-DDTHH:MM
const sudanLocal = (ms) => new Date(ms + 2 * 3_600_000).toISOString().slice(0, 16)

function roadKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h)) * 1.3
}

const party = (name) => ({ name, address: 'الخرطوم، السوق المركزي', phone: '+249912345678' })

// The trip form's data, loaded once per VU (as the portal caches it for the session)
let form = null

// A clerk books a trip at their branch and takes it through to the authorized manifest: open the
// form, maybe attach the invoice and packing list, save, generate the bill, pay it (simulated),
// refresh the status, and open the documents
export function booking() {
  if (!signIn(clerks)) return
  if (!form) {
    const reference = mustHave(api('GET', '/trips/reference', { kind: 'read' }), 'reference')
    const vehicles = mustHave(api('GET', '/vehicles', { kind: 'read' }), 'vehicles')
    const drivers = mustHave(api('GET', '/drivers', { kind: 'read' }), 'drivers')
    form = { cities: reference.cities, vehicles, drivers }
  } else {
    // The form opens with fresh suggestions each time
    api('GET', '/trips/suggestions', { kind: 'read' })
  }
  const vehicle = pick(form.vehicles)
  const bus = vehicle.vehicleType === 'bus'
  const origin = pick(form.cities)
  let destination = pick(form.cities)
  while (destination.id === origin.id) destination = pick(form.cities)
  const km = roadKm(origin, destination)
  const departure = Date.now() + (2 + Math.random() * 10) * 3_600_000
  const arrival = departure + (km / (bus ? 70 : 50) + 1) * 3_600_000

  const documents = []
  if (!bus && Math.random() < 1 / 3) {
    for (const docType of ['commercial_invoice', 'packing_list']) {
      const staged = upload(docType, http.file(pdf, `${docType}.pdf`, 'application/pdf'))
      if (staged) documents.push({ docType, token: staged.token })
    }
  }

  const tanker = vehicle.capacityUnit === 'liter'
  const items = bus
    ? []
    : [1, 2].map((n) => ({
        name: `بضاعة ${n}`,
        quantity: tanker ? 10000 : 10,
        unit: tanker ? 'liter' : 'ton',
        cargoType: tanker ? 'fuel' : 'general_cargo',
        packingType: tanker ? 'صهريج' : 'شوال',
        packageCount: 20,
        notes: null
      }))
  const seats = bus ? Math.min(vehicle.capacity, 40) : 0
  const passengers = Array.from({ length: seats }, (_, i) => ({
    fullName: `راكب ${i + 1}`,
    idType: 'national_id',
    idNumber: String(10000000000 + Math.floor(Math.random() * 89999999999)),
    seatNo: i + 1,
    isInfant: false,
    notes: null
  }))
  const trip = api('POST', '/trips', {
    kind: 'write',
    body: {
      vehicleId: vehicle.id,
      originCityId: origin.id,
      destinationCityId: destination.id,
      items,
      passengers,
      departureAt: sudanLocal(departure),
      arrivalAt: sudanLocal(arrival),
      tripKind: 'domestic',
      trailers: [],
      driverId: pick(form.drivers).id,
      shipper: bus ? party('') : party('شركة المرسل'),
      receiver: bus ? party('') : party('شركة المستلم'),
      documents
    }
  })
  if (!trip) return
  const id = trip.id
  api('GET', `/trips/${id}`, { kind: 'read', name: 'GET /trips/:id' })
  if (!api('POST', `/trips/${id}/bill`, { kind: 'write', name: 'POST /trips/:id/bill', body: {} }))
    return
  // Paying from the bank app takes a while; then the clerk refreshes
  sleep(1)
  api('POST', `/trips/${id}/simulate-payment`, {
    kind: 'write',
    name: 'POST /trips/:id/simulate-payment',
    body: {}
  })
  api('POST', `/trips/${id}/refresh`, { kind: 'write', name: 'POST /trips/:id/refresh', body: {} })
  // The trip page with the receipt and manifest (barcodes rendered by the API)
  api('GET', `/trips/${id}`, { kind: 'read', name: 'GET /trips/:id' })
}

// A company member following their trips: one page view per iteration
const LIST_VIEWS = [
  'pageSize=25',
  'pageSize=25&group=status',
  'pageSize=25&group=month',
  'pageSize=50&status=billed',
  'pageSize=25&sort=amount&direction=desc',
  'pageSize=25&page=3'
]
let myTrips = []
export function browse() {
  // One in five is an accountant (company-wide), the rest clerks (their branch)
  if (!signIn(__VU % 5 === 0 ? accountants : clerks)) return
  const roll = Math.random()
  if (roll < 0.15) {
    api('GET', '/auth/me', { kind: 'read' })
  } else if (roll < 0.55 || myTrips.length === 0) {
    const page = api('GET', `/trips?${pick(LIST_VIEWS)}&lang=ar`, {
      kind: 'read',
      name: 'GET /trips'
    })
    if (page && page.rows) myTrips = page.rows.map((r) => r.id)
  } else if (roll < 0.65) {
    api(
      'GET',
      `/trips?pageSize=25&query=${encodeURIComponent(pick(['الخرطوم', 'بورتسودان', 'سكر', '#12']))}`,
      {
        kind: 'read',
        name: 'GET /trips?search'
      }
    )
  } else if (roll < 0.9) {
    api('GET', `/trips/${pick(myTrips)}`, { kind: 'read', name: 'GET /trips/:id' })
  } else if (roll < 0.95) {
    api('GET', '/vehicles', { kind: 'read' })
  } else {
    api('GET', '/drivers', { kind: 'read' })
  }
}

// The 5 senior government staff follow the dashboard. Its history (whole past days, from the
// nightly aggregates) is fetched when they open it or change the filters, as the portal caches it
// until the next night; otherwise they refresh, which fetches today only.
const RANGES = [
  { preset: '30d' },
  { preset: '30d' },
  { preset: '7d' },
  { preset: '90d' },
  { preset: '12m' }
]
const BREAKDOWNS = ['route', 'originState', 'destinationState', 'cargoType', 'company', 'tripKind']
let dashboardView = null
export function govtDashboard() {
  if (!signIn(govtSeniors)) return
  // A new view 3 times in 10 (and the first time); otherwise a refresh of today
  if (!dashboardView || Math.random() < 0.3) {
    const filters = { range: pick(RANGES) }
    if (Math.random() < 0.3) filters.category = pick(['cargo', 'passenger'])
    dashboardView = {
      filters,
      view: { bucket: null, breakdown: pick(BREAKDOWNS), sort: 'revenue' }
    }
    api('POST', '/govt/dashboard/history', { kind: 'dashboard', body: dashboardView })
  }
  api('POST', '/govt/dashboard/today', { kind: 'dashboard', body: dashboardView })
}

// The other 95 government agents review: they search (this week's trips 9 times in 10), open a
// trip, and look at one of its documents about a third of the time
export function govtReview() {
  if (!signIn(govtAgents)) return
  const term = Math.random() < 0.9 ? pick(recentTerms) : pick(olderTerms)
  const results = api('GET', `/govt/search?query=${encodeURIComponent(term)}&page=1&pageSize=25`, {
    kind: 'read',
    name: 'GET /govt/search'
  })
  const found =
    results && results.rows && results.rows.length
      ? pick(results.rows).manifestId
      : pick(recentTripIds)
  const trip = api('GET', `/govt/trips/${found}`, { kind: 'read', name: 'GET /govt/trips/:id' })
  const documents = trip && trip.trip && trip.trip.documents
  if (documents && documents.length && Math.random() < 0.3) {
    api('GET', `/govt/documents/${documents[0].id}/file`, {
      kind: 'read',
      name: 'GET /govt/documents/:id/file',
      expect: 'raw'
    })
  }
}

// An occasional export: a month of trips and bills as Excel
export function exportData() {
  if (!signIn(govtUsers)) return
  api('POST', '/govt/exports', {
    kind: 'export',
    expect: 'raw',
    timeout: '120s',
    body: {
      filters: { range: { preset: '30d' } },
      dateBasis: 'trip',
      status: 'all',
      datasets: ['trips', 'bills'],
      formats: ['xlsx'],
      labels: { sheets: {}, columns: {}, values: {} }
    }
  })
}

// A checkpoint officer scans a QR code: mostly valid documents, some expired; each scan from its
// own phone (IP)
export function verify() {
  const token =
    Math.random() < 0.9 || expiredTokens.length === 0 ? pick(validTokens) : pick(expiredTokens)
  api('GET', `/verify/${token}`, { kind: 'verify', name: 'GET /verify/:token', ip: randomIp() })
}

// A fresh sign-in each iteration (the shift-start rush): Argon2id on every one
export function login() {
  const res = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ username: pick(clerks), password: PASSWORD }),
    {
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        'X-Forwarded-For': randomIp()
      },
      tags: { kind: 'login', name: 'POST /auth/login' }
    }
  )
  check(res, { 'POST /auth/login ok': (r) => r.status === 200 && r.json('ok') === true })
  // Signed out again, so every iteration is a new sign-in
  http.cookieJar().clear(BASE)
}
