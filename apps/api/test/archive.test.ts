// The rolling window: finished trips older than HOT_DAYS move to the archive and stay readable
// everywhere they're looked up (the trips list, a trip's page, the government search and exports,
// the verify page, the fleet's trip counts, the revenue summary), while the live tables keep only
// what's recent or unfinished.
import { beforeAll, describe, expect, test } from 'bun:test'
import { count, eq, sql } from 'drizzle-orm'
import { archive, certificates, dailyRevenue, getDb, manifests } from '../src/db'
import { archiveDueTrips, archiveLimits, nightlyArchive } from '../src/services/archive'
import { rebuildDailyRevenue } from '../src/services/dailyRevenue'
import { resetData, signedIn, type Browser } from './helpers'

const LABELS = { columns: {}, sheets: {}, values: {} }
const DAY_MS = 86_400_000
// "YYYY-MM-DDTHH:MM", local time, `days` ago
const local = (days: number): string => {
  const d = new Date(Date.now() - days * DAY_MS)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T08:00`
}
const dayOnly = (days: number): string => local(days).slice(0, 10)

let owner: Browser
let govt: Browser
const trip: Record<'oldPaid' | 'oldBilled' | 'recentPaid' | 'oldDraft', number> = {
  oldPaid: 0,
  oldBilled: 0,
  recentPaid: 0,
  oldDraft: 0
}
let vehicleId = 0

async function book(departureDaysAgo: number): Promise<number> {
  const reference = await owner.call('GET', '/trips/reference')
  const city = Object.fromEntries(
    reference.body.data.cities.map((c: { name: string; id: number }) => [c.name, c.id])
  )
  const branches = await owner.call('GET', '/branches')
  const drivers = await owner.call('GET', '/drivers')
  const created = await owner.call('POST', '/trips', {
    branchId: branches.body.data[0].id,
    vehicleId,
    originCityId: city.Khartoum,
    destinationCityId: city['Port Sudan'],
    items: [
      {
        name: 'Cement',
        quantity: 20,
        unit: 'ton',
        cargoType: 'general_cargo',
        packingType: 'Bags',
        packageCount: 400,
        notes: null
      }
    ],
    departureAt: local(departureDaysAgo),
    arrivalAt: local(departureDaysAgo - 1),
    tripKind: 'domestic',
    trailers: [],
    driverId: drivers.body.data[0].id,
    shipper: { name: 'Sender Co', address: 'Khartoum', phone: '0911111111' },
    receiver: { name: 'Receiver Co', address: 'Port Sudan', phone: '0922222222' }
  })
  expect(created.status).toBe(200)
  return created.body.data.id
}

async function pay(id: number, settle: boolean): Promise<void> {
  expect((await owner.call('POST', `/trips/${id}/bill`)).status).toBe(200)
  if (!settle) return
  expect((await owner.call('POST', `/trips/${id}/simulate-payment`)).status).toBe(200)
  expect((await owner.call('POST', `/trips/${id}/refresh`)).body.data.trip.status).toBe('certified')
}

beforeAll(async () => {
  await resetData()
  owner = (
    await signedIn('archive.owner', 'company_admin', {
      companyName: 'Archive Co',
      address: 'Khartoum',
      tin: '300999'
    })
  ).b
  govt = (await signedIn('archive.govt', 'govt_agent')).b
  vehicleId = (
    await owner.call('POST', '/vehicles', {
      plateNumber: 'KH 7/7777',
      registrationNo: 'R-7',
      vehicleType: 'heavy_duty_truck',
      capacity: 30,
      capacityUnit: 'ton'
    })
  ).body.data.id
  await owner.call('POST', '/drivers', { name: 'Ahmed Ali', phone: '0912345678' })

  trip.oldPaid = await book(45)
  trip.oldBilled = await book(44)
  trip.recentPaid = await book(5)
  trip.oldDraft = await book(43)
  await pay(trip.oldPaid, true)
  await pay(trip.oldBilled, false)
  await pay(trip.recentPaid, true)
  // A draft nobody has touched for 40 days
  await getDb().execute(
    sql`update manifests set updated_at = now() - interval '40 days' where id = ${trip.oldDraft}`
  )
}, 60_000)

const liveIds = async (): Promise<number[]> =>
  (await getDb().select({ id: manifests.id }).from(manifests)).map((r) => r.id).sort()
const archivedIds = async (): Promise<number[]> =>
  (await getDb().select({ id: archive.manifests.id }).from(archive.manifests))
    .map((r) => r.id)
    .sort()

describe('moving trips', () => {
  test('finished trips older than the window move; recent and unpaid ones stay', async () => {
    const summaryBefore = await getDb().select({ trips: dailyRevenue.trips }).from(dailyRevenue)
    // In batches of one, so the run loops
    archiveLimits.batch = 1
    try {
      expect(await archiveDueTrips()).toBe(2)
    } finally {
      archiveLimits.batch = 5_000
    }
    expect(await archivedIds()).toEqual([trip.oldPaid, trip.oldDraft].sort())
    expect(await liveIds()).toEqual([trip.oldBilled, trip.recentPaid].sort())
    // Its bill, certificate and items moved with it
    const [{ value }] = await getDb()
      .select({ value: count() })
      .from(certificates)
      .where(eq(certificates.manifestId, trip.oldPaid))
    expect(value).toBe(0)
    const [archived] = await getDb()
      .select({ value: count() })
      .from(archive.certificates)
      .where(eq(archive.certificates.manifestId, trip.oldPaid))
    expect(archived.value).toBe(1)
    // The summary is untouched, and a rebuild (it reads the views) gives the same figures
    expect(await getDb().select({ trips: dailyRevenue.trips }).from(dailyRevenue)).toEqual(
      summaryBefore
    )
    await rebuildDailyRevenue()
    const total = (rows: { trips: number }[]): number => rows.reduce((s, r) => s + r.trips, 0)
    expect(total(await getDb().select({ trips: dailyRevenue.trips }).from(dailyRevenue))).toBe(
      total(summaryBefore)
    )
  })

  test('a second run moves nothing, and the job only works at night', async () => {
    expect(await archiveDueTrips()).toBe(0)
    const noon = new Date()
    noon.setHours(12, 0, 0, 0)
    expect(await nightlyArchive(noon)).toBe(0)
  })
})

describe('archived trips stay readable', () => {
  test('the trips list of an older period shows them', async () => {
    const page = await owner.call('GET', `/trips?from=${dayOnly(60)}&to=${dayOnly(30)}`)
    const ids = page.body.data.rows.map((t: { id: number }) => t.id).sort()
    expect(ids).toEqual([trip.oldPaid, trip.oldBilled, trip.oldDraft].sort())
  })

  test("a trip's page opens read-only, with its bill and documents", async () => {
    const details = await owner.call('GET', `/trips/${trip.oldPaid}`)
    expect(details.status).toBe(200)
    expect(details.body.data).toMatchObject({ archived: true, trip: { status: 'certified' } })
    expect(details.body.data.trip.items).toHaveLength(1)
    expect(details.body.data.certificate.manifestNo).toStartWith('MNF-')
    expect((await owner.call('GET', `/trips/${trip.recentPaid}`)).body.data.archived).toBe(false)
    // An archived draft can't be edited, billed or deleted any more
    expect((await owner.call('DELETE', `/trips/${trip.oldDraft}`)).status).toBe(404)
    expect((await owner.call('POST', `/trips/${trip.oldDraft}/bill`)).status).toBe(404)
  })

  test('the government finds them, and exports include them', async () => {
    const found = await govt.call('GET', `/govt/search?query=%23${trip.oldPaid}`)
    expect(found.body.data.rows.map((t: { manifestId: number }) => t.manifestId)).toContain(
      trip.oldPaid
    )
    expect((await govt.call('GET', `/govt/trips/${trip.oldPaid}`)).body.data.archived).toBe(true)
    const exported = await govt.call('POST', '/govt/exports', {
      filters: { range: { preset: 'custom', from: dayOnly(60), to: dayOnly(0) } },
      dateBasis: 'trip',
      status: 'all',
      datasets: ['trips'],
      formats: ['csv'],
      labels: LABELS
    })
    expect(exported.status).toBe(200)
    const csv = new TextDecoder().decode(exported.body)
    const ids = csv
      .trim()
      .split('\r\n')
      .slice(1)
      .map((line) => Number(line.replace(/^\uFEFF/, '').split(',')[0]))
    expect(ids).toEqual(expect.arrayContaining(Object.values(trip)))
  })

  test('the verify page still answers for an archived certificate (expired)', async () => {
    const [cert] = await getDb()
      .select({ token: archive.certificates.qrToken })
      .from(archive.certificates)
      .where(eq(archive.certificates.manifestId, trip.oldPaid))
    const result = await owner.call('GET', `/verify/${cert.token}`)
    expect(result.status).toBe(200)
    expect(result.body.data.status).toBe('expired')
  })

  test("the vehicle's trip count includes archived trips, so it can't be deleted", async () => {
    const vehicles = await owner.call('GET', '/vehicles')
    expect(vehicles.body.data[0].tripCount).toBe(4)
    expect((await owner.call('DELETE', `/vehicles/${vehicleId}`)).body.error).toBe('vehicle_in_use')
  })
})
