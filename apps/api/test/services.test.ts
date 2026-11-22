// The services against Postgres: a company's trip from draft to authorized, and what the
// government sees of it (dashboard, search, taxes and fees), and the pricing guard
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { branches, getDb, manifests } from '../src/db'
import type { CompanyScope } from '../src/services/access'
import { addVehicle } from '../src/services/fleet'
import { addDriver } from '../src/services/drivers'
import {
  createTrip,
  deleteTrip,
  getReferenceData,
  listTrips,
  updateTrip
} from '../src/services/trips'
import {
  generateBill,
  getTripDetails,
  refreshBillStatus,
  simulatePayment
} from '../src/services/billing'
import { getDashboard } from '../src/services/dashboard'
import { searchTrips } from '../src/services/govtTrips'
import { createCharge, getChargesView, listCharges, updateCharge } from '../src/services/charges'
import { assertPricingAllowed, pricing } from '../src/services/pricing'
import { config } from '../src/config'
import { calculateCharges, type ChargeInput, type ChargeRecord } from '@masarat/shared/tax'
import { ensureDemoData } from '../src/services/demoData'
import { exportData } from '../src/services/exports'
import { DEFAULT_VIEW } from '@masarat/shared/analytics'
import { PERMISSIONS } from '@masarat/shared/permissions'
import type { TripInput } from '@masarat/shared/fleet'
import { createUser, resetData } from './helpers'

// The company admin's view (every branch) and their id
let scope: CompanyScope
let ownerId: number
let govtId: number
let tripInput: TripInput

beforeAll(async () => {
  await resetData()
  const owner = await createUser('nile.test', 'company_admin', {
    fullName: 'Owner Test',
    companyName: 'Nile Test Transport',
    address: 'Khartoum',
    tin: '300123'
  })
  ownerId = owner.id
  scope = { companyId: owner.companyId!, branchId: null }
  govtId = (await createUser('govt.test', 'govt_admin')).id
  const [branch] = await getDb()
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.companyId, scope.companyId))

  const vehicle = await addVehicle(scope.companyId, {
    plateNumber: 'KH 12/34567',
    registrationNo: 'R-1',
    vehicleType: 'heavy_duty_truck',
    capacity: 30,
    capacityUnit: 'ton'
  })
  const driver = await addDriver(scope.companyId, { name: 'Ahmed Ali', phone: '0912 345 678' })
  if (!vehicle.ok || !driver.ok) throw new Error('setup failed')

  const { cities } = await getReferenceData()
  const city = (name: string): number => cities.find((c) => c.name === name)!.id
  tripInput = {
    branchId: branch.id,
    vehicleId: vehicle.data.id,
    originCityId: city('Khartoum'),
    destinationCityId: city('Port Sudan'),
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
    driverId: driver.data.id,
    shipper: { name: 'Sender Co', address: 'Khartoum', phone: '0911111111' },
    receiver: { name: 'Receiver Co', address: 'Port Sudan', phone: '0922222222' }
  }
})

describe('company trip', () => {
  let tripId: number

  test('a new trip is a priced draft', async () => {
    const created = await createTrip(scope, ownerId, tripInput)
    expect(created.ok).toBe(true)
    if (!created.ok) return
    tripId = created.data.id
    expect(created.data.status).toBe('draft')
    expect(created.data.items).toHaveLength(1)
    // 20 t of general cargo at 2000 SDG per km per ton, plus 22% in taxes and the 1500 SDG fee
    expect(created.data.tripCost).toBe(created.data.distanceKm * 2000 * 20)
    expect(created.data.taxes.map((t) => t.code)).toEqual([
      'vat',
      'business_profit',
      'locality',
      'manifest_fee'
    ])
    expect(created.data.taxAmount).toBe(created.data.taxes.reduce((sum, t) => sum + t.amount, 0))
  })

  test('drafts can be edited', async () => {
    const updated = await updateTrip(scope, ownerId, tripId, {
      ...tripInput,
      items: [{ ...tripInput.items[0], quantity: 25 }]
    })
    expect(updated.ok && updated.data.cargoQuantity).toBe(25)
  })

  test('another company cannot see the trip', async () => {
    const other = await createUser('other.test', 'company_admin')
    const otherScope = { companyId: other.companyId!, branchId: null }
    expect((await listTrips(otherScope)).length).toBe(0)
    expect(await generateBill(otherScope, tripId)).toEqual({
      ok: false,
      error: 'manifest_not_found'
    })
  })

  test('bill, payment and refresh certify it', async () => {
    const billed = await generateBill(scope, tripId)
    expect(billed.ok).toBe(true)
    if (!billed.ok) return
    expect(billed.data.trip.status).toBe('billed')
    expect(billed.data.payment?.billId).toMatch(/^\d{22}$/)
    // Asking again returns the same bill
    const again = await generateBill(scope, tripId)
    expect(again.ok && again.data.payment?.billId).toBe(billed.data.payment!.billId)
    expect(await updateTrip(scope, ownerId, tripId, tripInput)).toEqual({
      ok: false,
      error: 'not_draft'
    })

    // Not paid yet: refreshing changes nothing
    const pending = await refreshBillStatus(scope, tripId)
    expect(pending.ok && pending.data.trip.status).toBe('billed')

    expect((await simulatePayment(scope, tripId)).ok).toBe(true)
    const paid = await refreshBillStatus(scope, tripId)
    expect(paid.ok).toBe(true)
    if (!paid.ok) return
    expect(paid.data.trip.status).toBe('certified')
    expect(paid.data.payment?.status).toBe('paid')
    expect(paid.data.certificate?.certificateNo).toMatch(/^MSR-\d{4}-\d{6}$/)
    expect(paid.data.certificate?.manifestNo).toMatch(/^MNF-\d{4}-\d{6}$/)
    expect(paid.data.trip.carrier?.name).toBe('Nile Test Transport')
  })

  test('a draft can be deleted, a billed trip cannot', async () => {
    const draft = await createTrip(scope, ownerId, tripInput)
    if (!draft.ok) throw new Error('create failed')
    expect(await deleteTrip(scope, draft.data.id)).toEqual({ ok: true, data: null })
    const [gone] = await getDb().select().from(manifests).where(eq(manifests.id, draft.data.id))
    expect(gone).toBeUndefined()
    expect(await deleteTrip(scope, tripId)).toEqual({ ok: false, error: 'not_draft' })
  })
})

describe('government', () => {
  test('the dashboard counts the paid bill', async () => {
    const [trip] = await listTrips(scope)
    const data = await getDashboard({ range: { preset: '30d' } }, DEFAULT_VIEW)
    const paid = (await listTrips(scope)).filter((t) => t.status === 'certified')
    expect(data.kpis.revenue).toBe(paid.reduce((sum, t) => sum + t.taxAmount, 0))
    expect(data.byTax.reduce((sum, line) => sum + line.revenue, 0)).toBe(data.kpis.revenue)
    expect(data.recentBills.length).toBeGreaterThan(0)
    expect(trip).toBeDefined()
  })

  test('search ignores case and finds plates in Arabic digits', async () => {
    const byCompany = await searchTrips({ query: 'nile TEST' })
    expect(byCompany.ok && byCompany.data.rows.length).toBeGreaterThan(0)
    const byPlate = await searchTrips({ query: '٣٤٥٦٧' })
    expect(byPlate.ok && byPlate.data.rows.length).toBeGreaterThan(0)
  })
})

describe('export', () => {
  test('writes a workbook and one CSV per dataset', async () => {
    const result = await exportData({
      filters: { range: { preset: '30d' } },
      dateBasis: 'trip',
      status: 'all',
      datasets: ['trips', 'bills', 'items', 'taxLines'],
      formats: ['xlsx', 'csv'],
      labels: { columns: {}, sheets: {}, values: {} }
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.files.map((f) => f.name.split('.').pop())).toEqual([
      'xlsx',
      'csv',
      'csv',
      'csv',
      'csv'
    ])
    expect(result.data.rows.trips).toBe(1)
    expect(result.data.rows.taxLines).toBe(4)
  })
})

// After the export, which counts the one billed trip above
describe('taxes and fees', () => {
  const vat = async (): Promise<ChargeRecord> =>
    (await listCharges()).find((c) => c.code === 'vat')!
  const asInput = (c: ChargeRecord): ChargeInput => ({
    name: c.name,
    nameAr: c.nameAr,
    kind: c.kind,
    cargoValue: c.cargoValue,
    passengerValue: c.passengerValue,
    active: c.active
  })

  test('changes are logged field by field under the government user', async () => {
    const before = await vat()
    const updated = await updateCharge(govtId, before.id, {
      ...asInput(before),
      cargoValue: 1500,
      passengerValue: null
    })
    expect(updated.ok).toBe(true)
    const view = await getChargesView()
    expect(view.charges.find((c) => c.code === 'vat')).toMatchObject({
      cargoValue: 1500,
      passengerValue: null
    })
    expect(
      view.history.slice(0, 2).map((h) => [h.field, h.oldValue, h.newValue, h.changedBy])
    ).toEqual(
      expect.arrayContaining([
        ['cargoValue', '1700', '1500', 'govt.test'],
        ['passengerValue', '1700', null, 'govt.test']
      ])
    )
    expect(
      await updateCharge(govtId, before.id, { ...asInput(before), cargoValue: 10_001 })
    ).toEqual({ ok: false, error: 'invalid_tax_rate' })
    // A charge must apply to some kind of trip
    expect(
      await updateCharge(govtId, before.id, {
        ...asInput(before),
        cargoValue: null,
        passengerValue: null
      })
    ).toEqual({ ok: false, error: 'invalid_charge' })
    await updateCharge(govtId, before.id, asInput(before))
  })

  test('custom fees apply to their kind of trip; switched-off ones to none', async () => {
    const base = { active: true }
    await createCharge(govtId, {
      ...base,
      name: 'Port fee',
      nameAr: 'رسوم الميناء',
      kind: 'fixed',
      cargoValue: 500,
      passengerValue: null
    })
    await createCharge(govtId, {
      ...base,
      name: 'Road levy',
      nameAr: 'رسم الطرق',
      kind: 'percent',
      cargoValue: null,
      passengerValue: 250
    })
    const list = await listCharges()
    const port = list.find((c) => c.name === 'Port fee')!
    expect(port.code).toBe(`custom_${port.id}`)
    expect(port.builtin).toBe(false)

    const cargo = calculateCharges(100_000, list, 'cargo')
    expect(cargo.lines.map((l) => l.code)).toEqual([
      'vat',
      'business_profit',
      'locality',
      'manifest_fee',
      port.code
    ])
    expect(cargo.total).toBe(17_000 + 3_000 + 2_000 + 1_500 + 500)
    const passenger = calculateCharges(100_000, list, 'passenger')
    // Percentages before fixed fees
    expect(passenger.lines.map((l) => l.name)).toEqual([
      'Value added tax',
      'Business profit tax',
      'Locality tax',
      'Road levy',
      'Manifest fee'
    ])
    expect(passenger.total).toBe(17_000 + 3_000 + 2_000 + 2_500 + 1_500)

    await updateCharge(govtId, port.id, { ...asInput(port), active: false })
    expect(calculateCharges(100_000, await listCharges(), 'cargo').total).toBe(23_500)
  })

  test('a bill keeps the lines it was issued with, whatever changes later', async () => {
    const draft = await createTrip(scope, ownerId, tripInput)
    if (!draft.ok) throw new Error(draft.error)
    const billed = await generateBill(scope, draft.data.id)
    if (!billed.ok) throw new Error(billed.error)
    const lines = billed.data.trip.taxes

    const before = await vat()
    await updateCharge(govtId, before.id, {
      ...asInput(before),
      name: 'VAT (renamed)',
      cargoValue: 500
    })
    const after = await getTripDetails(scope, draft.data.id)
    expect(after.ok && after.data.trip.taxes).toEqual(lines)
    expect(lines.find((l) => l.code === 'vat')).toMatchObject({
      name: 'Value added tax',
      nameAr: 'ضريبة القيمة المضافة',
      rateBps: 1700
    })
    await updateCharge(govtId, before.id, asInput(before))
  })
})

describe('pricing', () => {
  test('tickets are the rate per km per seat × distance', async () => {
    expect(await pricing.ticketRatePerKm()).toBe(80)
    expect(await pricing.ticketPrice(875)).toBe(70_000)
  })

  test('production refuses the development formula', () => {
    expect(() => assertPricingAllowed()).not.toThrow()
    config.appEnv = 'production'
    try {
      expect(() => assertPricingAllowed()).toThrow(/development formula/)
      // A real pricing service is allowed
      expect(() => assertPricingAllowed({ ...pricing, isFormula: false })).not.toThrow()
    } finally {
      config.appEnv = 'development'
    }
  })
})

describe('demo data', () => {
  test('seeds the demo companies once', async () => {
    await resetData()
    await ensureDemoData()
    const trips = await getDb().$count(manifests)
    expect(trips).toBeGreaterThan(500)
    await ensureDemoData()
    expect(await getDb().$count(manifests)).toBe(trips)
  }, 60_000)
})

describe('permissions', () => {
  test('the database accepts exactly the permissions in the code', async () => {
    const [row] = await getDb().execute<{ def: string }>(
      sql`select pg_get_constraintdef(oid) as def from pg_constraint
          where conname = 'role_permissions_permission_check'`
    )
    const allowed = [...row.def.matchAll(/'([a-z.]+)'/g)].map((m) => m[1])
    expect(allowed.sort()).toEqual([...PERMISSIONS].sort())
  })
})
