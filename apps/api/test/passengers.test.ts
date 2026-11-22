// Passenger trips (buses): passengers and seats, infants, ticket pricing, the passenger manifest,
// what the verify page and the government see of them, departure and arrival, templates and the
// government's settings
import { beforeEach, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { strFromU8, unzipSync } from 'fflate'
import { getDb } from '../src/db'
import { verifyManifest } from '../src/services/verify'
import { resetData, signedIn, type Browser } from './helpers'

const OWNER = { companyName: 'Nile Buses', address: 'Khartoum', tin: '300123' }

interface Ids {
  busId: number
  driverId: number
  branchId: number
  cities: Record<string, number>
}

async function setup(b: Browser): Promise<Ids> {
  const bus = await b.call('POST', '/vehicles', {
    plateNumber: 'KH 1/2345',
    registrationNo: 'B-1',
    vehicleType: 'bus',
    capacity: 3,
    capacityUnit: 'seat'
  })
  expect(bus.status).toBe(200)
  const driver = await b.call('POST', '/drivers', { name: 'Ahmed Ali', phone: '0912345678' })
  const reference = await b.call('GET', '/trips/reference')
  const cities = Object.fromEntries(
    reference.body.data.cities.map((c: { name: string; id: number }) => [c.name, c.id])
  )
  const branches = await b.call('GET', '/branches')
  return {
    busId: bus.body.data.id,
    driverId: driver.body.data.id,
    branchId: branches.body.data[0].id,
    cities
  }
}

const NID = '12345678901'

function busTrip(ids: Ids, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    branchId: ids.branchId,
    vehicleId: ids.busId,
    originCityId: ids.cities.Khartoum,
    destinationCityId: ids.cities['Port Sudan'],
    items: [],
    passengers: [
      {
        fullName: 'فاطمة أحمد',
        idType: 'national_id',
        idNumber: NID,
        seatNo: 1,
        isInfant: false,
        notes: null
      },
      {
        fullName: 'محمد علي',
        idType: 'passport',
        idNumber: 'p 1234567',
        seatNo: 2,
        isInfant: false,
        notes: 'مصري'
      },
      { fullName: 'سارة', idType: null, idNumber: null, seatNo: 1, isInfant: true, notes: 'رضيع' }
    ],
    departureAt: '2026-11-20T07:00',
    arrivalAt: '2026-11-20T20:00',
    tripKind: 'export',
    trailers: [],
    driverId: ids.driverId,
    shipper: { name: '', address: '', phone: '' },
    receiver: { name: '', address: '', phone: '' },
    ...overrides
  }
}

beforeEach(resetData)

describe('passenger trips', () => {
  test('priced per ticket, billed at the passenger values, issued as a PSG manifest', async () => {
    const { b } = await signedIn('owner.one', 'company_admin', OWNER)
    const ids = await setup(b)
    const created = await b.call('POST', '/trips', busTrip(ids))
    expect(created.status).toBe(200)
    const trip = created.body.data
    expect(trip).toMatchObject({
      category: 'passenger',
      cargoType: null,
      // Two tickets: the infant has none
      cargoQuantity: 2,
      cargoUnit: 'seat',
      // Always domestic, never with documents
      tripKind: 'domestic',
      ratePerKm: 80,
      ticketPrice: 80 * trip.distanceKm,
      tripCost: 2 * 80 * trip.distanceKm
    })
    // IDs are stored normalized
    expect(trip.passengers.map((p: { idNumber: string | null }) => p.idNumber)).toEqual([
      NID,
      'P1234567',
      null
    ])

    const billed = await b.call('POST', `/trips/${trip.id}/bill`)
    expect(billed.body.data.trip.status).toBe('billed')
    // No late boarding: the passengers are fixed once billed
    expect((await b.call('PUT', `/trips/${trip.id}`, busTrip(ids))).body.error).toBe('not_draft')

    await b.call('POST', `/trips/${trip.id}/simulate-payment`)
    const paid = await b.call('POST', `/trips/${trip.id}/refresh`)
    const certificate = paid.body.data.certificate
    expect(certificate.manifestNo).toMatch(/^PSG-\d{4}-\d{6}$/)
    // Valid until the estimated arrival plus the passenger margin (24 h)
    expect(certificate.validUntil).toBe(new Date(2026, 10, 21, 20, 0).getTime())

    // The verify page counts heads, and shows nobody's name or ID
    const [{ qr_token: token }] = await getDb().execute<{ qr_token: string }>(
      sql`select qr_token from certificates`
    )
    // (the service itself: the route's per-IP limit is shared with the other test files)
    const verified = await verifyManifest(token)
    if (!verified.ok) throw new Error(verified.error)
    expect(verified.data.passengers).toEqual({ seated: 2, infants: 1 })
    expect(JSON.stringify(verified.data)).not.toContain(NID)
    expect(JSON.stringify(verified.data)).not.toContain('فاطمة')
  }, 20_000)

  test('a bill needs an ID for everyone with a seat', async () => {
    const { b } = await signedIn('owner.one', 'company_admin', OWNER)
    const ids = await setup(b)
    const draft = await b.call(
      'POST',
      '/trips',
      busTrip(ids, {
        passengers: [
          {
            fullName: 'بلا هوية',
            idType: null,
            idNumber: null,
            seatNo: 1,
            isInfant: false,
            notes: null
          }
        ]
      })
    )
    expect(draft.status).toBe(200)
    expect((await b.call('POST', `/trips/${draft.body.data.id}/bill`)).body.error).toBe(
      'incomplete_manifest'
    )
  })

  test('seats, infants, IDs, capacity and the arrival are checked', async () => {
    const { b } = await signedIn('owner.one', 'company_admin', OWNER)
    const ids = await setup(b)
    const passenger = (
      seatNo: number,
      extra: Record<string, unknown> = {}
    ): Record<string, unknown> => ({
      fullName: 'راكب',
      idType: 'national_id',
      idNumber: `1234567890${seatNo}`,
      seatNo,
      isInfant: false,
      notes: null,
      ...extra
    })
    const save = async (overrides: Record<string, unknown>): Promise<string | undefined> =>
      (await b.call('POST', '/trips', busTrip(ids, overrides))).body.error
    expect(await save({ passengers: [passenger(1), passenger(1)] })).toBe('seat_taken')
    expect(await save({ passengers: [passenger(4)] })).toBe('invalid_passengers')
    expect(
      await save({ passengers: [passenger(1), passenger(2, { isInfant: true, idNumber: '' })] })
    ).toBe('invalid_passengers')
    expect(await save({ passengers: [passenger(1, { idNumber: '123' })] })).toBe(
      'invalid_passengers'
    )
    expect(await save({ arrivalAt: '2026-11-20T06:00' })).toBe('invalid_arrival')
    expect(await save({ departureAt: '2026-11-31T07:00' })).toBe('invalid_date')
    // A draft may have no passengers yet
    expect(await save({ passengers: [] })).toBeUndefined()
    // A bus is counted in seats, and nothing else is
    const truckInSeats = await b.call('POST', '/vehicles', {
      plateNumber: 'KH 2/2345',
      registrationNo: 'T-1',
      vehicleType: 'lorry',
      capacity: 10,
      capacityUnit: 'seat'
    })
    expect(truckInSeats.body.error).toBe('unit_mismatch')
  })
})

describe('the government and passenger trips', () => {
  test('CSV cells a spreadsheet would run as formulas stay text; Excel dates are Sudan time', async () => {
    const { b } = await signedIn('owner.one', 'company_admin', OWNER)
    const ids = await setup(b)
    const formula = '=HYPERLINK("http://evil.example","x")'
    const trip = await b.call(
      'POST',
      '/trips',
      busTrip(ids, {
        passengers: [
          {
            fullName: formula,
            idType: null,
            idNumber: null,
            seatNo: 1,
            isInfant: false,
            notes: '+1+1'
          }
        ]
      })
    )
    expect(trip.status).toBe(200)
    const { b: govt } = await signedIn('chief', 'govt_admin')
    const input = {
      filters: { range: { preset: 'custom', from: '2026-11-01', to: '2026-11-30' } },
      dateBasis: 'trip',
      status: 'all',
      datasets: ['passengers'],
      formats: ['csv'],
      labels: { columns: {}, sheets: {}, values: {} }
    }
    const csv = strFromU8(new Uint8Array((await govt.call('POST', '/govt/exports', input)).body))
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")"`)
    expect(csv).toContain(",'+1+1")
    // The seat stays a number
    expect(csv.split('\r\n')[1]).toContain(',1,')

    const xlsx = await govt.call('POST', '/govt/exports', { ...input, formats: ['xlsx'] })
    const { default: ExcelJS } = await import('exceljs')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(xlsx.body)
    // Departure 07:00 Sudan time: the cell holds 07:00 (Excel has no zones)
    const departure = workbook.worksheets[0].getRow(2).getCell(3).value as Date
    expect(departure.toISOString()).toBe('2026-11-20T07:00:00.000Z')
  })

  test('search by an exact ID number, through its index', async () => {
    const { b } = await signedIn('owner.one', 'company_admin', OWNER)
    const ids = await setup(b)
    const trip = (await b.call('POST', '/trips', busTrip(ids))).body.data
    const { b: govt } = await signedIn('chief', 'govt_admin')
    const found = await govt.call('GET', `/govt/search?query=${NID}`)
    expect(found.body.data.rows.map((r: { manifestId: number }) => r.manifestId)).toEqual([trip.id])
    // Arabic digits and a passport written loosely find the same trip
    const arabic = NID.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)])
    expect(
      (await govt.call('GET', `/govt/search?query=${encodeURIComponent(arabic)}`)).body.data.total
    ).toBe(1)
    expect((await govt.call('GET', '/govt/search?query=p1234567')).body.data.total).toBe(1)
    // Part of a number isn't an ID
    expect((await govt.call('GET', `/govt/search?query=${NID.slice(0, 9)}`)).body.data.total).toBe(
      0
    )

    const plan = await getDb().transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`)
      return tx.execute<{ 'QUERY PLAN': string }>(
        sql`explain select manifest_id from trip_passengers where id_number = ${NID}`
      )
    })
    expect(plan.map((r) => r['QUERY PLAN']).join('\n')).toContain('trip_passengers_id_number_idx')
  })

  test('the passengers export leaves the ID numbers out unless asked', async () => {
    const { b } = await signedIn('owner.one', 'company_admin', OWNER)
    const ids = await setup(b)
    await b.call('POST', '/trips', busTrip(ids))
    const { b: govt } = await signedIn('chief', 'govt_admin')
    const input = {
      filters: { range: { preset: 'custom', from: '2026-11-01', to: '2026-11-30' } },
      dateBasis: 'trip',
      status: 'all',
      datasets: ['passengers'],
      formats: ['csv'],
      labels: { columns: {}, sheets: {}, values: {} }
    }
    const without = await govt.call('POST', '/govt/exports', input)
    expect(without.headers.get('x-export-rows')).toBe('{"passengers":3}')
    const text = strFromU8(new Uint8Array(without.body))
    expect(text).not.toContain(NID)
    expect(text.split('\r\n')[0]).not.toContain('idNumber')
    const withIds = await govt.call('POST', '/govt/exports', { ...input, includeIdNumbers: true })
    expect(strFromU8(new Uint8Array(withIds.body))).toContain(NID)
    // Several files still come zipped
    const both = await govt.call('POST', '/govt/exports', {
      ...input,
      datasets: ['trips', 'passengers']
    })
    expect(Object.keys(unzipSync(new Uint8Array(both.body))).sort()).toHaveLength(2)
  })

  test('settings: admins change the margin and speeds, agents are refused', async () => {
    const { b: govt } = await signedIn('chief', 'govt_admin')
    const settings = (await govt.call('GET', '/govt/settings')).body.data
    expect(settings).toEqual({
      validityMarginHours: { cargo: 24, passenger: 24 },
      averageSpeedKmh: { cargo: 50, passenger: 70 }
    })
    const changed = { ...settings, validityMarginHours: { cargo: 48, passenger: 12 } }
    expect((await govt.call('PUT', '/govt/settings', changed)).body.data).toEqual(changed)
    expect(
      (
        await govt.call('PUT', '/govt/settings', {
          ...changed,
          averageSpeedKmh: { cargo: 0, passenger: 70 }
        })
      ).body.error
    ).toBe('invalid_settings')
    const { b: agent } = await signedIn('analyst', 'govt_agent')
    expect((await agent.call('GET', '/govt/settings')).status).toBe(403)
    await govt.call('PUT', '/govt/settings', settings)
  })
})

describe('templates', () => {
  test('kept by the admin, listed for clerks; buses only', async () => {
    const { b: admin, companyId } = await signedIn('owner.one', 'company_admin', OWNER)
    const ids = await setup(admin)
    const template = {
      name: 'الخرطوم - بورتسودان 07:00',
      branchId: ids.branchId,
      originCityId: ids.cities.Khartoum,
      destinationCityId: ids.cities['Port Sudan'],
      vehicleId: ids.busId,
      driverId: ids.driverId,
      departureTime: '07:00',
      durationMinutes: 750
    }
    const created = await admin.call('POST', '/templates', template)
    expect(created.body.data).toMatchObject(template)
    expect(
      (await admin.call('POST', '/templates', { ...template, departureTime: '25:00' })).body.error
    ).toBe('invalid_template')
    const lorry = await admin.call('POST', '/vehicles', {
      plateNumber: 'KH 3/2345',
      registrationNo: 'T-2',
      vehicleType: 'lorry',
      capacity: 10,
      capacityUnit: 'ton'
    })
    expect(
      (await admin.call('POST', '/templates', { ...template, vehicleId: lorry.body.data.id })).body
        .error
    ).toBe('invalid_template')

    const { b: clerk } = await signedIn('clerk.one', 'clerk', { companyId: companyId! })
    expect((await clerk.call('GET', '/templates')).body.data).toHaveLength(1)
    expect((await clerk.call('POST', '/templates', template)).status).toBe(403)
    expect((await admin.call('DELETE', `/templates/${created.body.data.id}`)).status).toBe(200)
    expect((await clerk.call('GET', '/templates')).body.data).toHaveLength(0)
  })
})
