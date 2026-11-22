// The owner portal's routes: vehicles, drivers, trips (paged), billing and attachments
import { beforeEach, describe, expect, test } from 'bun:test'
import { getDb, manifests } from '../src/db'
import { resetData, signedIn, type Browser } from './helpers'

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a])

const OWNER = {
  fullName: 'Owner',
  companyName: 'Nile Test',
  address: 'Khartoum',
  tin: '300123'
}

async function setup(
  b: Browser
): Promise<{ vehicleId: number; driverId: number; cities: Record<string, number> }> {
  const vehicle = await b.call('POST', '/vehicles', {
    plateNumber: 'KH 12/34567',
    registrationNo: 'R-1',
    vehicleType: 'heavy_duty_truck',
    capacity: 30,
    capacityUnit: 'ton'
  })
  const driver = await b.call('POST', '/drivers', { name: 'Ahmed Ali', phone: '0912345678' })
  const reference = await b.call('GET', '/trips/reference')
  const cities = Object.fromEntries(
    reference.body.data.cities.map((c: { name: string; id: number }) => [c.name, c.id])
  )
  return { vehicleId: vehicle.body.data.id, driverId: driver.body.data.id, cities }
}

function tripInput(
  ids: { vehicleId: number; driverId: number; cities: Record<string, number> },
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    vehicleId: ids.vehicleId,
    originCityId: ids.cities.Khartoum,
    destinationCityId: ids.cities['Port Sudan'],
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
    tripDate: '2026-11-20',
    tripKind: 'domestic',
    trailers: [],
    driverId: ids.driverId,
    shipper: { name: 'Sender Co', address: 'Khartoum', phone: '0911111111' },
    receiver: { name: 'Receiver Co', address: 'Port Sudan', phone: '0922222222' },
    ...overrides
  }
}

async function upload(
  b: Browser,
  bytes: Uint8Array,
  name: string,
  docType = 'commercial_invoice'
): ReturnType<Browser['call']> {
  const form = new FormData()
  form.set('docType', docType)
  form.set('file', new File([bytes], name))
  return b.call('POST', '/documents', form)
}

beforeEach(resetData)

describe('access', () => {
  test('owner routes need an owner session', async () => {
    const { b: govt } = await signedIn('govt.one', 'govt')
    expect((await govt.call('GET', '/vehicles')).status).toBe(403)
    const { b: anon } = { b: (await import('./helpers')).browser() }
    expect((await anon.call('GET', '/trips')).status).toBe(401)
  })

  test("another owner's vehicles, trips and files are not found", async () => {
    const { b } = await signedIn('owner.one', 'owner', OWNER)
    const ids = await setup(b)
    const trip = await b.call('POST', '/trips', tripInput(ids))
    const { b: other } = await signedIn('owner.two', 'owner')
    expect((await other.call('PUT', `/vehicles/${ids.vehicleId}`, {})).status).toBe(404)
    expect((await other.call('GET', `/trips/${trip.body.data.id}`)).status).toBe(404)
    expect((await other.call('POST', `/trips/${trip.body.data.id}/bill`)).status).toBe(404)
    expect((await other.call('GET', '/trips')).body.data.total).toBe(0)
  })
})

describe('trip to certificate', () => {
  test('draft, bill, pay (demo), refresh', async () => {
    const { b } = await signedIn('owner.one', 'owner', OWNER)
    const ids = await setup(b)
    const created = await b.call('POST', '/trips', tripInput(ids))
    expect(created.status).toBe(200)
    const id = created.body.data.id

    const billed = await b.call('POST', `/trips/${id}/bill`)
    expect(billed.body.data.trip.status).toBe('billed')
    expect((await b.call('POST', `/trips/${id}/simulate-payment`)).status).toBe(200)
    const paid = await b.call('POST', `/trips/${id}/refresh`)
    expect(paid.body.data.trip.status).toBe('certified')
    expect(paid.body.data.certificate.manifestNo).toMatch(/^MNF-/)
    expect((await b.call('DELETE', `/trips/${id}`)).body.error).toBe('not_draft')
  })
})

describe('demo-only actions', () => {
  test('paying a bill is refused outside demo mode', async () => {
    const { config } = await import('../src/config')
    const { b } = await signedIn('owner.one', 'owner', OWNER)
    const ids = await setup(b)
    const { id } = (await b.call('POST', '/trips', tripInput(ids))).body.data
    await b.call('POST', `/trips/${id}/bill`)
    config.demoMode = false
    try {
      expect((await b.call('POST', `/trips/${id}/simulate-payment`)).status).toBe(403)
    } finally {
      config.demoMode = true
    }
  })
})

describe('attachments', () => {
  test('upload, save with the trip, preview; other owners and fakes are refused', async () => {
    const { b } = await signedIn('owner.one', 'owner', OWNER)
    const ids = await setup(b)
    const staged = await upload(b, PDF, 'فاتورة.pdf')
    expect(staged.status).toBe(200)
    const token = staged.body.data.token

    // A file that isn't what its name says
    expect((await upload(b, new Uint8Array([1, 2, 3, 4]), 'fake.pdf')).body.error).toBe(
      'invalid_document'
    )
    // Another owner can't attach this upload
    const { b: other } = await signedIn('owner.two', 'owner')
    const otherIds = await setup2(other)
    const stolen = await other.call(
      'POST',
      '/trips',
      tripInput(otherIds, { documents: [{ docType: 'commercial_invoice', token }] })
    )
    expect(stolen.body.error).toBe('invalid_document')

    const created = await b.call(
      'POST',
      '/trips',
      tripInput(ids, { documents: [{ docType: 'commercial_invoice', token }] })
    )
    const [document] = created.body.data.documents
    expect(document.fileName).toBe('فاتورة.pdf')

    const file = await b.call('GET', `/documents/${document.id}/file`)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('application/pdf')
    expect(file.headers.get('content-disposition')).toStartWith('inline;')
    expect(new Uint8Array(file.body)).toEqual(PDF)
    expect((await other.call('GET', `/documents/${document.id}/file`)).status).toBe(404)

    const scan = await b.call('POST', '/documents/scan', {
      docType: 'commercial_invoice',
      source: { id: document.id },
      unit: 'ton',
      scenario: null
    })
    expect(scan.status).toBe(200)
  }, 20_000)
})

// A second owner's vehicle and driver, with a plate of their own
async function setup2(
  b: Browser
): Promise<{ vehicleId: number; driverId: number; cities: Record<string, number> }> {
  const vehicle = await b.call('POST', '/vehicles', {
    plateNumber: 'RS 3/111',
    registrationNo: 'R-2',
    vehicleType: 'heavy_duty_truck',
    capacity: 30,
    capacityUnit: 'ton'
  })
  const driver = await b.call('POST', '/drivers', { name: 'Omer', phone: '0913333333' })
  const reference = await b.call('GET', '/trips/reference')
  const cities = Object.fromEntries(
    reference.body.data.cities.map((c: { name: string; id: number }) => [c.name, c.id])
  )
  return { vehicleId: vehicle.body.data.id, driverId: driver.body.data.id, cities }
}

describe('paged trips list', () => {
  test('pages, totals, filters, search and groups across pages', async () => {
    const { b } = await signedIn('owner.one', 'owner', OWNER)
    const ids = await setup(b)
    // 30 trips over two months, every third one to Kassala
    for (let i = 0; i < 30; i++) {
      const res = await b.call(
        'POST',
        '/trips',
        tripInput(ids, {
          tripDate:
            i < 12
              ? `2026-10-${String(i + 1).padStart(2, '0')}`
              : `2026-11-${String(i - 11).padStart(2, '0')}`,
          destinationCityId: i % 3 === 0 ? ids.cities.Kassala : ids.cities['Port Sudan']
        })
      )
      expect(res.status).toBe(200)
    }

    const first = await b.call('GET', '/trips?pageSize=25&sort=tripDate&direction=desc')
    expect(first.body.data).toMatchObject({ total: 30, overall: 30, page: 1, pageSize: 25 })
    expect(first.body.data.rows).toHaveLength(25)
    const second = await b.call('GET', '/trips?pageSize=25&page=2&sort=tripDate&direction=desc')
    expect(second.body.data.rows).toHaveLength(5)
    // Newest first, and no trip on both pages
    const dates = [...first.body.data.rows, ...second.body.data.rows].map(
      (t: { tripDate: number }) => t.tripDate
    )
    expect(dates).toEqual([...dates].sort((a, b) => b - a))
    const allIds = new Set(
      [...first.body.data.rows, ...second.body.data.rows].map((t: { id: number }) => t.id)
    )
    expect(allIds.size).toBe(30)

    const kassala = await b.call('GET', '/trips?query=kassala')
    expect(kassala.body.data).toMatchObject({ total: 10, overall: 30 })
    const october = await b.call('GET', '/trips?from=2026-10-01&to=2026-10-31')
    expect(october.body.data.total).toBe(12)

    // Grouped by month across pages: page 1 holds November (18) and part of October
    const grouped = await b.call('GET', '/trips?pageSize=25&group=month')
    const groups = grouped.body.data.groups
    expect(groups.map((g: { key: string }) => g.key)).toEqual(['2026-11', '2026-10'])
    expect(groups.map((g: { count: number }) => g.count)).toEqual([18, 12])
    // Each group's total is its trips' amounts, from every page
    const due = async (from: string, to: string): Promise<number> => {
      const month = await b.call('GET', `/trips?from=${from}&to=${to}&pageSize=100`)
      return month.body.data.rows.reduce(
        (sum: number, t: { taxAmount: number }) => sum + t.taxAmount,
        0
      )
    }
    expect(groups[0].totalDue).toBe(await due('2026-11-01', '2026-11-30'))
    expect(grouped.body.data.rows[0].groupKey).toBe('2026-11')
    const page2 = await b.call('GET', '/trips?pageSize=25&page=2&group=month')
    expect(page2.body.data.groups).toEqual([
      { key: '2026-10', count: 12, totalDue: await due('2026-10-01', '2026-10-31') }
    ])

    const [{ count }] = [{ count: await getDb().$count(manifests) }]
    expect(count).toBe(30)
  }, 60_000)

  test('a page past the end shows the last page', async () => {
    const { b } = await signedIn('owner.one', 'owner', OWNER)
    const ids = await setup(b)
    await b.call('POST', '/trips', tripInput(ids))
    const result = await b.call('GET', '/trips?page=9')
    expect(result.body.data).toMatchObject({ page: 1, total: 1 })
  })
})
