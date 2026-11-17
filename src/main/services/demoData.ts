// Demo data for the government dashboard: a few fleet companies with a year of trips, bills,
// payments and certificates, written to the real tables so live trips mix in with them.
// Demo owners are flagged with users.is_demo; regenerating deletes only their rows.
import { randomBytes } from 'crypto'
import { and, eq, inArray } from 'drizzle-orm'
import {
  certificates,
  cities,
  esaliSimBills,
  getDb,
  manifests,
  payments,
  taxRates,
  users,
  vehicles
} from '../db'
import type { CargoType, QuantityUnit, VehicleType } from '../../shared/fleet'
import { DEMO_GOVT_ACCOUNT, DEMO_OWNER_ACCOUNTS, type DemoAccount } from '../../shared/demo'
import { PLATE_CODES, formatPlate } from '../../shared/plate'
import { calculateTax, estimateRoadKm } from '../../shared/tax'
import { dropSessionsOf, hashPassword } from './auth'
import { certificateNoFor, validUntilFor } from './billing'
import { newBillId } from './esali'

const DAY_MS = 86_400_000
const HISTORY_DAYS = 365
// Trips per day at the start of the year, before growth, seasonality and noise
const BASE_TRIPS_PER_DAY = 3.4

// Same seed every time, so each regenerate gives the same-looking dashboard (shifted to today)
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Random = () => number
const between = (rand: Random, min: number, max: number): number =>
  min + Math.floor(rand() * (max - min + 1))
const pick = <T>(rand: Random, items: readonly T[]): T => items[Math.floor(rand() * items.length)]
const digits = (rand: Random, count: number): string =>
  Array.from({ length: count }, () => Math.floor(rand() * 10)).join('')

function pickWeighted<T>(rand: Random, items: readonly { value: T; weight: number }[]): T {
  const total = items.reduce((sum, item) => sum + item.weight, 0)
  let roll = rand() * total
  for (const item of items) {
    roll -= item.weight
    if (roll < 0) return item.value
  }
  return items[items.length - 1].value
}

// Vehicle mix and capacity ranges, in the vehicle's unit
const FLEET_MIX: readonly { value: VehicleType; weight: number }[] = [
  { value: 'heavy_duty_truck', weight: 4 },
  { value: 'tanker', weight: 3 },
  { value: 'container_truck', weight: 3 },
  { value: 'lorry', weight: 2 },
  { value: 'jumbo_truck', weight: 1.5 },
  { value: 'light_duty_truck', weight: 1 }
]

const CAPACITY: Record<
  VehicleType,
  { unit: QuantityUnit; min: number; max: number; step: number }
> = {
  tanker: { unit: 'liter', min: 30_000, max: 45_000, step: 1000 },
  container_truck: { unit: 'ton', min: 25, max: 40, step: 1 },
  heavy_duty_truck: { unit: 'ton', min: 30, max: 50, step: 1 },
  jumbo_truck: { unit: 'ton', min: 40, max: 60, step: 1 },
  lorry: { unit: 'ton', min: 10, max: 20, step: 1 },
  light_duty_truck: { unit: 'ton', min: 3, max: 8, step: 1 }
}

const CARGO_FOR: Record<VehicleType, CargoType> = {
  tanker: 'fuel',
  container_truck: 'containers',
  heavy_duty_truck: 'general_cargo',
  jumbo_truck: 'general_cargo',
  lorry: 'general_cargo',
  light_duty_truck: 'general_cargo'
}

// Busy corridors (either direction); the remaining weight goes to random city pairs
const CORRIDORS: readonly [string, string, number][] = [
  ['Port Sudan', 'Khartoum', 18],
  ['Port Sudan', 'Atbara', 6],
  ['Port Sudan', 'Kassala', 5],
  ['Khartoum', 'Wad Medani', 9],
  ['Khartoum', 'El Obeid', 7],
  ['Khartoum', 'Kassala', 5],
  ['Khartoum', 'Gedaref', 5],
  ['Khartoum', 'Atbara', 5],
  ['Khartoum', 'Kūstī', 4],
  ['Omdurman', 'Dongola', 4],
  ['Khartoum North', 'Shendi', 3],
  ['Wad Medani', 'Gedaref', 3],
  ['El Obeid', 'Nyala', 3],
  ['Kūstī', 'El Obeid', 2],
  ['Sannār', 'Ed Damazin', 2]
]
const RANDOM_ROUTE_WEIGHT = 12

interface CityPoint {
  id: number
  lat: number
  lng: number
}

interface SeedVehicle {
  id: number
  vehicleType: VehicleType
  capacity: number
}

// How likely a trip, by age in days, is still a draft or an unpaid bill
function statusFor(rand: Random, ageDays: number): 'draft' | 'billed' | 'certified' {
  const roll = rand()
  if (ageDays <= 10) return roll < 0.15 ? 'draft' : roll < 0.4 ? 'billed' : 'certified'
  return roll < 0.03 ? 'draft' : roll < 0.06 ? 'billed' : 'certified'
}

// Trips on a given day: growing ~40% over the year, fewer on Fridays and in the rainy season
function tripsOn(rand: Random, day: Date, ageDays: number): number {
  const growth = 1 + 0.4 * (1 - ageDays / HISTORY_DAYS)
  const weekday = day.getDay() === 5 ? 0.45 : 1
  const month = day.getMonth()
  const season = month >= 6 && month <= 8 ? 0.8 : 1
  const expected = BASE_TRIPS_PER_DAY * growth * weekday * season * (0.6 + rand() * 0.8)
  return Math.floor(expected + rand())
}

async function createAccount(account: DemoAccount): Promise<number | null> {
  const db = getDb()
  const taken = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, account.username))
    .get()
  // Someone already signed up with this username; leave their account alone
  if (taken) return null
  return db
    .insert(users)
    .values({
      role: account.role,
      username: account.username,
      passwordHash: await hashPassword(account.password),
      fullName: account.fullName,
      companyName: account.companyName,
      isDemo: true
    })
    .returning({ id: users.id })
    .get().id
}

async function seedOwners(): Promise<void> {
  // Accounts first: hashing passwords is async and the transaction can't await
  const ownerIds: number[] = []
  for (const account of DEMO_OWNER_ACCOUNTS) {
    const id = await createAccount(account)
    if (id !== null) ownerIds.push(id)
  }
  if (ownerIds.length === 0) return
  try {
    seedTrips(ownerIds)
  } catch (err) {
    // Don't leave empty demo accounts behind, or the next startup would skip seeding
    deleteDemoOwners()
    throw err
  }
}

function seedTrips(ownerIds: number[]): void {
  const db = getDb()
  const rand = mulberry32(20261117)
  const cityRows = db
    .select({ id: cities.id, name: cities.name, lat: cities.lat, lng: cities.lng })
    .from(cities)
    .all()
  const cityByName = new Map(cityRows.map((c) => [c.name, c]))
  const rates = new Map(
    db
      .select()
      .from(taxRates)
      .all()
      .map((r) => [r.cargoType, r])
  )

  const routes: { value: [CityPoint, CityPoint] | null; weight: number }[] = CORRIDORS.flatMap(
    ([a, b, weight]) => {
      const from = cityByName.get(a)
      const to = cityByName.get(b)
      return from && to ? [{ value: [from, to] as [CityPoint, CityPoint], weight }] : []
    }
  )
  routes.push({ value: null, weight: RANDOM_ROUTE_WEIGHT })

  // Keep generated identifiers clear of anything already in the DB
  const plates = new Set(
    db
      .select({ plate: vehicles.plateNumber })
      .from(vehicles)
      .all()
      .map((v) => v.plate)
  )
  const billIds = new Set([
    ...db
      .select({ id: payments.billId })
      .from(payments)
      .all()
      .map((p) => p.id),
    ...db
      .select({ id: esaliSimBills.billId })
      .from(esaliSimBills)
      .all()
      .map((b) => b.id)
  ])
  const refs = new Set(
    db
      .select({ ref: payments.paymentRef })
      .from(payments)
      .all()
      .map((p) => p.ref)
  )

  const uniquePlate = (): string => {
    for (;;) {
      const plate = formatPlate({
        code: pick(rand, PLATE_CODES.slice(0, 6)),
        series: between(rand, 1, 99),
        number: between(rand, 1, 99999)
      })
      if (plates.has(plate)) continue
      plates.add(plate)
      return plate
    }
  }
  const uniqueBillId = (issuedAt: Date): string => {
    for (;;) {
      const billId = newBillId(issuedAt, digits(rand, 13))
      if (billIds.has(billId)) continue
      billIds.add(billId)
      return billId
    }
  }
  const uniqueRef = (): string => {
    for (;;) {
      const ref = `BNK${digits(rand, 9)}`
      if (refs.has(ref)) continue
      refs.add(ref)
      return ref
    }
  }

  const now = Date.now()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  db.transaction((tx) => {
    const fleet: SeedVehicle[] = []
    for (const ownerId of ownerIds) {
      const count = between(rand, 8, 14)
      for (let i = 0; i < count; i++) {
        const vehicleType = pickWeighted(rand, FLEET_MIX)
        const { unit, min, max, step } = CAPACITY[vehicleType]
        const capacity = between(rand, min / step, max / step) * step
        const createdAt = new Date(today.getTime() - between(rand, HISTORY_DAYS, 500) * DAY_MS)
        const { id } = tx
          .insert(vehicles)
          .values({
            ownerId,
            plateNumber: uniquePlate(),
            vehicleType,
            capacity,
            capacityUnit: unit,
            createdAt,
            updatedAt: createdAt
          })
          .returning({ id: vehicles.id })
          .get()
        fleet.push({ id, vehicleType, capacity })
      }
    }

    for (let ageDays = HISTORY_DAYS - 1; ageDays >= 0; ageDays--) {
      const tripDate = new Date(today)
      tripDate.setDate(today.getDate() - ageDays)
      const trips = tripsOn(rand, tripDate, ageDays)

      for (let i = 0; i < trips; i++) {
        const vehicle = pick(rand, fleet)
        const cargoType = CARGO_FOR[vehicle.vehicleType]
        const rate = rates.get(cargoType)
        if (!rate) continue

        let [origin, destination] = pickWeighted(rand, routes) ?? [
          pick(rand, cityRows),
          pick(rand, cityRows)
        ]
        if (origin.id === destination.id) continue
        if (rand() < 0.5) [origin, destination] = [destination, origin]

        const quantity =
          rate.unit === 'liter'
            ? Math.round((vehicle.capacity * (0.6 + rand() * 0.4)) / 1000) * 1000
            : Math.max(1, Math.round(vehicle.capacity * (0.5 + rand() * 0.5)))
        const distanceKm = estimateRoadKm(origin, destination)
        const taxAmount = calculateTax(rate, distanceKm, quantity)
        if (taxAmount <= 0) continue

        // Registered up to two days ahead of the trip, during working hours
        const createdAt = new Date(
          tripDate.getTime() - between(rand, 0, 2) * DAY_MS + between(rand, 7, 18) * 3_600_000
        )
        if (createdAt.getTime() > now) createdAt.setTime(now - between(rand, 1, 60) * 60_000)

        let status = statusFor(rand, ageDays)
        const billedAt = new Date(
          Math.min(now, createdAt.getTime() + between(rand, 5, 360) * 60_000)
        )
        const paidAt = new Date(billedAt.getTime() + between(rand, 10, 48 * 60) * 60_000)
        if (status === 'certified' && paidAt.getTime() > now) status = 'billed'

        const { id: manifestId } = tx
          .insert(manifests)
          .values({
            vehicleId: vehicle.id,
            originCityId: origin.id,
            destinationCityId: destination.id,
            cargoType,
            cargoQuantity: quantity,
            cargoUnit: rate.unit,
            tripDate,
            distanceKm,
            ratePerKm: rate.ratePerKm,
            taxAmount,
            status,
            createdAt,
            updatedAt: status === 'draft' ? createdAt : status === 'billed' ? billedAt : paidAt
          })
          .returning({ id: manifests.id })
          .get()
        if (status === 'draft') continue

        const paid = status === 'certified'
        const billId = uniqueBillId(billedAt)
        const paymentRef = paid ? uniqueRef() : null
        tx.insert(esaliSimBills)
          .values({
            billId,
            amount: taxAmount,
            status: paid ? 'paid' : 'pending',
            paymentRef,
            paidAt: paid ? paidAt : null,
            createdAt: billedAt,
            updatedAt: paid ? paidAt : billedAt
          })
          .run()
        tx.insert(payments)
          .values({
            manifestId,
            billId,
            amount: taxAmount,
            status: paid ? 'paid' : 'pending',
            bank: paid ? 'E-Sali' : null,
            paymentRef,
            paidAt: paid ? paidAt : null,
            createdAt: billedAt,
            updatedAt: paid ? paidAt : billedAt
          })
          .run()
        if (!paid) continue

        tx.insert(certificates)
          .values({
            manifestId,
            certificateNo: certificateNoFor(manifestId, paidAt),
            qrToken: randomBytes(16).toString('hex'),
            issuedAt: paidAt,
            validUntil: validUntilFor(tripDate),
            createdAt: paidAt,
            updatedAt: paidAt
          })
          .run()
      }
    }
  })
}

const demoOwnerIds = (): number[] =>
  getDb()
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isDemo, true), eq(users.role, 'owner')))
    .all()
    .map((u) => u.id)

// Deletes the demo owners and everything that hangs off them, children first
function deleteDemoOwners(): void {
  const ownerIds = demoOwnerIds()
  if (ownerIds.length === 0) return
  dropSessionsOf(new Set(ownerIds))

  getDb().transaction((tx) => {
    const demoVehicles = tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(inArray(vehicles.ownerId, ownerIds))
    const demoManifests = tx
      .select({ id: manifests.id })
      .from(manifests)
      .where(inArray(manifests.vehicleId, demoVehicles))
    const demoBills = tx
      .select({ billId: payments.billId })
      .from(payments)
      .where(inArray(payments.manifestId, demoManifests))

    tx.delete(esaliSimBills).where(inArray(esaliSimBills.billId, demoBills)).run()
    tx.delete(certificates).where(inArray(certificates.manifestId, demoManifests)).run()
    tx.delete(payments).where(inArray(payments.manifestId, demoManifests)).run()
    tx.delete(manifests).where(inArray(manifests.vehicleId, demoVehicles)).run()
    tx.delete(vehicles).where(inArray(vehicles.ownerId, ownerIds)).run()
    tx.delete(users).where(inArray(users.id, ownerIds)).run()
  })
}

// On startup: seed once if there are no demo owners yet, and make sure the demo government
// account exists
export async function ensureDemoData(): Promise<void> {
  if (demoOwnerIds().length === 0) await seedOwners()
  await createAccount(DEMO_GOVT_ACCOUNT)
}

// Government panel "Regenerate demo data": rebuilds the demo owners' data; hand-made data stays
export async function regenerateDemoData(): Promise<void> {
  deleteDemoOwners()
  await seedOwners()
  await createAccount(DEMO_GOVT_ACCOUNT)
}
