// Demo data for the government dashboard: a few transport companies, each with its branches and
// members, and a year of trips, bills, payments and certificates, written to the real tables so
// live trips mix in with them. Demo companies are flagged with companies.is_demo; regenerating
// deletes only them and what hangs off them.
import { randomBytes } from 'crypto'
import { log } from '../log'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  branches,
  certificates,
  cities,
  companies,
  drivers,
  esaliSimBills,
  getDb,
  manifestCargoItems,
  manifests,
  manifestCharges,
  manifestTrailers,
  tripDocuments,
  tripPassengers,
  tripTemplates,
  payments,
  roles,
  users,
  vehicles
} from '../db'
import {
  totalInVehicleUnit,
  type CargoItem,
  type CargoType,
  type QuantityUnit,
  type VehicleType
} from '@masarat/shared/fleet'
import type { PassengerRecord } from '@masarat/shared/passengers'
import { DEMO_COMPANIES, DEMO_GOVT_ACCOUNTS, type DemoCompany } from '@masarat/shared/demo'
import { PLATE_CODES, formatPlate } from '@masarat/shared/plate'
import { DEFAULT_SETTINGS, suggestedArrival } from '@masarat/shared/settings'
import {
  calculateCharges,
  calculateItemsCost,
  calculateTicketPrice,
  estimateRoadKm
} from '@masarat/shared/tax'
import { hashPassword } from './auth'
import { listCharges } from './charges'
import { createCompany } from './companies'
import { pricing } from './pricing'
import { config } from '../config'
import { certificateNoFor, manifestNoFor, validUntilFor } from './billing'
import { removeTripFolder } from './documents'
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

// Vehicle mix and capacity ranges, in the vehicle's unit. Buses are added on their own.
type TruckType = Exclude<VehicleType, 'bus'>
const FLEET_MIX: readonly { value: TruckType; weight: number }[] = [
  { value: 'heavy_duty_truck', weight: 4 },
  { value: 'tanker', weight: 3 },
  { value: 'container_truck', weight: 3 },
  { value: 'lorry', weight: 2 },
  { value: 'jumbo_truck', weight: 1.5 },
  { value: 'light_duty_truck', weight: 1 }
]

const CAPACITY: Record<TruckType, { unit: QuantityUnit; min: number; max: number; step: number }> =
  {
    tanker: { unit: 'liter', min: 30_000, max: 45_000, step: 1000 },
    container_truck: { unit: 'ton', min: 25, max: 40, step: 1 },
    heavy_duty_truck: { unit: 'ton', min: 30, max: 50, step: 1 },
    jumbo_truck: { unit: 'ton', min: 40, max: 60, step: 1 },
    lorry: { unit: 'ton', min: 10, max: 20, step: 1 },
    light_duty_truck: { unit: 'ton', min: 3, max: 8, step: 1 }
  }

const CARGO_FOR: Record<TruckType, CargoType> = {
  tanker: 'fuel',
  container_truck: 'containers',
  heavy_duty_truck: 'general_cargo',
  jumbo_truck: 'general_cargo',
  lorry: 'general_cargo',
  light_duty_truck: 'general_cargo'
}

// Share of tanker trips carrying non-fuel liquids
const LIQUIDS_SHARE = 0.25
// Mixed loads: big trucks that also carry a container, fuel tankers with a liquids compartment
const MIXED_TRUCK_SHARE = 0.15
const MIXED_TANKER_SHARE = 0.1

// Turns the last item of a multi-item load into another cargo type, keeping its quantity
function mixLoad(rand: Random, items: CargoItem[], cargoType: CargoType): void {
  if (items.length < 2) return
  const last = items[items.length - 1]
  items[items.length - 1] = { ...last, cargoType, name: pick(rand, ITEM_NAMES[cargoType]) }
}

// Cargo item names (Arabic: they appear on the certificate, which is always Arabic)
const ITEM_NAMES: Record<CargoType, readonly string[]> = {
  fuel: ['جازولين', 'بنزين', 'كيروسين'],
  liquids: ['مياه شرب', 'زيت طعام', 'دبس (مولاس)', 'زيت محركات'],
  containers: [
    'حاوية ٤٠ قدم - أجهزة كهربائية',
    'حاوية ٢٠ قدم - قطع غيار سيارات',
    'حاوية ٤٠ قدم - ملابس وأقمشة',
    'حاوية ٢٠ قدم - أدوية ومستلزمات طبية',
    'حاوية ٤٠ قدم - أثاثات'
  ],
  general_cargo: [
    'أسمنت',
    'دقيق قمح',
    'سكر',
    'ذرة رفيعة',
    'سمسم',
    'حديد تسليح',
    'صمغ عربي',
    'فول سوداني',
    'أسمدة زراعية'
  ]
}

// Demo drivers' names, combined at random
const DRIVER_FIRST_NAMES = [
  'عثمان',
  'الطيب',
  'حسن',
  'عبد الله',
  'محمد',
  'إبراهيم',
  'يوسف',
  'آدم',
  'بشير',
  'صالح',
  'عمر',
  'الصادق'
]
const DRIVER_LAST_NAMES = [
  'أحمد',
  'محمد الحسن',
  'عبد الرحمن',
  'إدريس',
  'آدم',
  'الطاهر',
  'خليل',
  'موسى',
  'بابكر',
  'النور'
]

// Passengers' names: the drivers' first names and some women's, with the same family names
const WOMEN_FIRST_NAMES = ['فاطمة', 'آمنة', 'مريم', 'سعاد', 'هدى', 'نفيسة', 'زينب', 'سارة']

// The intercity bus routes, by city name, and how often each runs
const BUS_ROUTES: readonly [string, string, number][] = [
  ['Khartoum', 'Port Sudan', 5],
  ['Khartoum', 'Wad Madani', 5],
  ['Khartoum', 'El Obeid', 3],
  ['Khartoum', 'Kassala', 3],
  ['Khartoum', 'Atbara', 3],
  ['Omdurman', 'Dongola', 2],
  ['Khartoum', 'Gedaref', 2],
  ['Kosti', 'El Obeid', 1]
]
// Chance a bus makes a trip on a given day
const BUS_TRIP_SHARE = 0.4
// Average speeds for the demo arrival times (as the settings' defaults)
const TRUCK_KMH = 50
const BUS_KMH = 70

// Packing details are filled in after the load is split
const UNPACKED = { packingType: null, packageCount: null, notes: null }

// Splits a load (in the vehicle's unit) into 1-4 named items, rounded down so the total never
// grows past the load
function cargoItems(
  rand: Random,
  cargoType: CargoType,
  load: number,
  unit: QuantityUnit
): CargoItem[] {
  const names = [...ITEM_NAMES[cargoType]].sort(() => rand() - 0.5)
  const count = Math.min(
    names.length,
    cargoType === 'fuel' ? between(rand, 1, 2) : between(rand, 1, 4)
  )
  const weights = Array.from({ length: count }, () => 0.5 + rand())
  const weightSum = weights.reduce((a, b) => a + b, 0)
  const items: CargoItem[] = []
  weights.forEach((weight, i) => {
    const part = (load * weight) / weightSum
    if (unit === 'liter') {
      const liters = Math.floor(part / 500) * 500
      if (liters <= 0) return
      items.push(
        liters % 1000 === 0 && rand() < 0.35
          ? { ...UNPACKED, name: names[i], quantity: liters / 1000, unit: 'm3', cargoType }
          : { ...UNPACKED, name: names[i], quantity: liters, unit: 'liter', cargoType }
      )
    } else if (part >= 1 && rand() < 0.65) {
      items.push({
        ...UNPACKED,
        name: names[i],
        quantity: Math.floor(part),
        unit: 'ton',
        cargoType
      })
    } else {
      const kg = Math.floor((part * 1000) / 50) * 50
      if (kg > 0) items.push({ ...UNPACKED, name: names[i], quantity: kg, unit: 'kg', cargoType })
    }
  })
  return items
}

// Busy corridors (either direction); the remaining weight goes to random city pairs
const CORRIDORS: readonly [string, string, number][] = [
  ['Port Sudan', 'Khartoum', 18],
  ['Port Sudan', 'Atbara', 6],
  ['Port Sudan', 'Kassala', 5],
  ['Khartoum', 'Wad Madani', 9],
  ['Khartoum', 'El Obeid', 7],
  ['Khartoum', 'Kassala', 5],
  ['Khartoum', 'Gedaref', 5],
  ['Khartoum', 'Atbara', 5],
  ['Khartoum', 'Kosti', 4],
  ['Omdurman', 'Dongola', 4],
  ['Bahri', 'Shendi', 3],
  ['Wad Madani', 'Gedaref', 3],
  ['El Obeid', 'Nyala', 3],
  ['Kosti', 'El Obeid', 2],
  ['Sennar', 'Ed Damazin', 2]
]
const RANDOM_ROUTE_WEIGHT = 12

interface CityPoint {
  id: number
  name: string
  nameAr: string | null
  lat: number
  lng: number
}

// A demo company as the trips need it: its carrier details, and its branches with the clerk who
// books there
interface SeedCompany {
  id: number
  name: string
  address: string
  tin: string
  branches: { id: number; cityId: number; clerkId: number }[]
}

interface SeedVehicle {
  id: number
  companyId: number
  vehicleType: VehicleType
  capacity: number
}

// Senders and receivers: traders, factories and agents. Each gets an address in the trip's
// origin or destination city.
const PARTY_NAMES = [
  'شركة السلام للتجارة العامة',
  'مصنع النيل للأسمنت',
  'شركة الجزيرة للمطاحن',
  'مؤسسة البركة للاستيراد والتصدير',
  'شركة البحر الأحمر للتوكيلات',
  'مجموعة الصافي التجارية',
  'شركة كردفان للحبوب الزيتية',
  'مصنع سنار للسكر',
  'شركة الخرطوم للمواد الغذائية',
  'وكالة الشرق للشحن',
  'شركة دارفور للصمغ العربي',
  'مخازن الأمل التجارية',
  'شركة النهضة للمواد الإنشائية',
  'مؤسسة الفجر للأدوية',
  'شركة الواحة للمحروقات',
  'محلات الإخلاص للأقمشة'
]
const DISTRICTS = [
  'المنطقة الصناعية',
  'السوق الكبير',
  'حي المطار',
  'الميناء',
  'شارع النيل',
  'السوق الشعبي',
  'المنطقة الحرة'
]

// Packing for each cargo type, with the weight of one package in the item's unit family
// (kg for tons, liters for tankers); bulk loads count as one package
const PACKING: Record<CargoType, readonly { name: string; unitSize: number | null }[]> = {
  fuel: [{ name: 'سائب', unitSize: null }],
  liquids: [
    { name: 'سائب', unitSize: null },
    { name: 'براميل', unitSize: 200 }
  ],
  containers: [{ name: 'حاوية', unitSize: null }],
  general_cargo: [
    { name: 'شوالات', unitSize: 50 },
    { name: 'كراتين', unitSize: 20 },
    { name: 'طرود', unitSize: 25 },
    { name: 'بالات', unitSize: 200 }
  ]
}
const ITEM_NOTES = ['يُحفظ بعيدًا عن الرطوبة', 'قابل للكسر', 'تُفرَّغ بالرافعة', 'لا يُرصّ فوقه']
const NOTES_SHARE = 0.1

// Packing type, number of packages and (sometimes) notes for a split item
function packed(rand: Random, item: CargoItem): CargoItem {
  const option = pick(rand, PACKING[item.cargoType])
  // The item's amount in kg or liters
  const amount =
    item.unit === 'ton'
      ? item.quantity * 1000
      : item.unit === 'm3'
        ? item.quantity * 1000
        : item.quantity
  return {
    ...item,
    packingType: option.name,
    packageCount: option.unitSize ? Math.max(1, Math.round(amount / option.unitSize)) : 1,
    notes: rand() < NOTES_SHARE ? pick(rand, ITEM_NOTES) : null
  }
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

// A demo company with its roles, branches and members; null when one of its usernames or phones
// is already someone else's (their account is left alone)
async function createDemoCompany(def: DemoCompany): Promise<SeedCompany | null> {
  const db = getDb()
  const members = [def.admin, def.accountant, ...def.branches.map((b) => b.clerk)]
  const [taken] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      inArray(
        users.username,
        members.map((m) => m.username)
      )
    )
    .limit(1)
  if (taken) return null
  // Everyone in a demo company has the company's password: hashed once
  const passwordHash = await hashPassword(def.admin.password)
  return db.transaction(async (tx) => {
    const { company, adminRoleId } = await createCompany(tx, {
      name: def.name,
      address: def.address,
      tin: def.tin,
      isDemo: true
    })
    const roleIds = new Map(
      (await tx.select().from(roles).where(eq(roles.companyId, company.id))).map((role) => [
        role.key,
        role.id
      ])
    )
    const cityRows = await tx.select({ id: cities.id, name: cities.name }).from(cities)
    const cityId = (name: string): number => {
      const found = cityRows.find((c) => c.name === name)
      if (!found) throw new Error(`Demo branch city not found: ${name}`)
      return found.id
    }
    type NewMember = Omit<typeof users.$inferInsert, 'roleId'>
    const account = (m: (typeof members)[number]): NewMember => ({
      kind: 'company',
      companyId: company.id,
      username: m.username,
      passwordHash,
      fullName: m.fullName,
      phone: m.phone,
      isDemo: true
    })
    await tx.insert(users).values([
      { ...account(def.admin), roleId: adminRoleId },
      { ...account(def.accountant), roleId: roleIds.get('accountant')! }
    ])
    const seeded: SeedCompany['branches'] = []
    for (const branch of def.branches) {
      const [{ id }] = await tx
        .insert(branches)
        .values({ companyId: company.id, name: branch.name, cityId: cityId(branch.city) })
        .returning({ id: branches.id })
      const [clerk] = await tx
        .insert(users)
        .values({ ...account(branch.clerk), roleId: roleIds.get('clerk')!, branchId: id })
        .returning({ id: users.id })
      seeded.push({ id, cityId: cityId(branch.city), clerkId: clerk.id })
    }
    return { id: company.id, name: def.name, address: def.address, tin: def.tin, branches: seeded }
  })
}

// The demo government accounts, unless their usernames are taken
async function createGovtAccounts(): Promise<void> {
  const db = getDb()
  for (const account of DEMO_GOVT_ACCOUNTS) {
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, account.username))
      .limit(1)
    if (taken) continue
    const [role] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(isNull(roles.companyId), eq(roles.key, account.role)))
      .limit(1)
    await db.insert(users).values({
      kind: 'govt',
      roleId: role.id,
      username: account.username,
      passwordHash: await hashPassword(account.password),
      fullName: account.fullName,
      phone: account.phone,
      isDemo: true
    })
  }
}

async function seedCompanies(): Promise<void> {
  try {
    // Companies first, outside the trips' transaction: hashing the passwords takes a while
    const seeded: SeedCompany[] = []
    for (const def of DEMO_COMPANIES) {
      const company = await createDemoCompany(def)
      if (company) seeded.push(company)
    }
    if (seeded.length > 0) await seedTrips(seeded)
  } catch (err) {
    // Don't leave empty demo companies behind, or the next startup would skip seeding. Only this
    // attempt's companies exist here: seedCompanies runs when there are no demo companies left.
    await deleteDemoCompanies()
    throw err
  }
}

// Rows are inserted this many at a time, well under Postgres's limit of parameters per query
const BATCH_ROWS = 1000

async function insertInBatches<T>(
  rows: readonly T[],
  insert: (batch: T[]) => Promise<unknown>
): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_ROWS) await insert(rows.slice(i, i + BATCH_ROWS))
}

async function seedTrips(seeded: SeedCompany[]): Promise<void> {
  const db = getDb()
  const rand = mulberry32(20261117)
  const cityRows = await db
    .select({
      id: cities.id,
      name: cities.name,
      nameAr: cities.nameAr,
      lat: cities.lat,
      lng: cities.lng
    })
    .from(cities)
    .orderBy(cities.id)
  const cityByName = new Map(cityRows.map((c) => [c.name, c]))
  const rateList = await pricing.cargoRates(db)
  const rates = new Map(rateList.map((r) => [r.cargoType, r]))
  // Demo history is billed at the taxes and fees as they are when it's seeded
  const chargeList = await listCharges(db)

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
    (await db.select({ plate: vehicles.plateNumber }).from(vehicles)).map((v) => v.plate)
  )
  const billIds = new Set([
    ...(await db.select({ id: payments.billId }).from(payments)).map((p) => p.id),
    ...(await db.select({ id: esaliSimBills.billId }).from(esaliSimBills)).map((b) => b.id)
  ])
  const refs = new Set(
    (await db.select({ ref: payments.paymentRef }).from(payments)).map((p) => p.ref)
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

  // Registration numbers, drivers and the manifest details (trip type, trailers, sender,
  // receiver, packing) come from their own stream, so adding them didn't change the trips the
  // main stream generates
  const extra = mulberry32(20261118)
  // Departure hours, the buses and their passenger trips: streams of their own, so the cargo
  // trips above stay as they were
  const times = mulberry32(20261119)
  const pax = mulberry32(20261120)
  const uniqueTrailerPlate = (): string => {
    for (;;) {
      const plate = formatPlate({
        code: pick(extra, PLATE_CODES.slice(0, 6)),
        series: between(extra, 1, 99),
        number: between(extra, 1, 99999)
      })
      if (plates.has(plate)) continue
      plates.add(plate)
      return plate
    }
  }
  const partyIn = (city: CityPoint): { name: string; address: string; phone: string } => ({
    name: pick(extra, PARTY_NAMES),
    address: `${city.nameAr ?? city.name}، ${pick(extra, DISTRICTS)}`,
    phone: `+2499${digits(extra, 8)}`
  })
  const companyById = new Map(seeded.map((c) => [c.id, c]))

  await db.transaction(async (tx) => {
    // A trip's own rows, written in batches once every manifest has its id
    const itemRows: (typeof manifestCargoItems.$inferInsert)[] = []
    const trailerRows: (typeof manifestTrailers.$inferInsert)[] = []
    const taxRows: (typeof manifestCharges.$inferInsert)[] = []
    const simBillRows: (typeof esaliSimBills.$inferInsert)[] = []
    const paymentRows: (typeof payments.$inferInsert)[] = []
    const certificateRows: (typeof certificates.$inferInsert)[] = []

    const fleet: SeedVehicle[] = []
    const driversOf = new Map<number, { id: number; name: string; phone: string }[]>()
    for (const { id: companyId } of seeded) {
      const driverCount = between(extra, 5, 8)
      const phones = new Set<string>()
      while (phones.size < driverCount) phones.add(`+2499${digits(extra, 8)}`)
      driversOf.set(
        companyId,
        await tx
          .insert(drivers)
          .values(
            [...phones].map((phone) => ({
              companyId,
              name: `${pick(extra, DRIVER_FIRST_NAMES)} ${pick(extra, DRIVER_LAST_NAMES)}`,
              phone
            }))
          )
          .returning({ id: drivers.id, name: drivers.name, phone: drivers.phone })
      )

      const count = between(rand, 8, 14)
      for (let i = 0; i < count; i++) {
        const vehicleType = pickWeighted(rand, FLEET_MIX)
        const { unit, min, max, step } = CAPACITY[vehicleType]
        const capacity = between(rand, min / step, max / step) * step
        const createdAt = new Date(today.getTime() - between(rand, HISTORY_DAYS, 500) * DAY_MS)
        const [{ id }] = await tx
          .insert(vehicles)
          .values({
            companyId,
            plateNumber: uniquePlate(),
            registrationNo: digits(extra, 7),
            vehicleType,
            capacity,
            capacityUnit: unit,
            createdAt,
            updatedAt: createdAt
          })
          .returning({ id: vehicles.id })
        fleet.push({ id, companyId, vehicleType, capacity })
      }
    }

    for (let ageDays = HISTORY_DAYS - 1; ageDays >= 0; ageDays--) {
      const departureAt = new Date(today)
      departureAt.setDate(today.getDate() - ageDays)
      const trips = tripsOn(rand, departureAt, ageDays)

      for (let i = 0; i < trips; i++) {
        const vehicle = pick(rand, fleet)
        const cargoType =
          vehicle.vehicleType === 'tanker' && rand() < LIQUIDS_SHARE
            ? 'liquids'
            : CARGO_FOR[vehicle.vehicleType]
        const rate = rates.get(cargoType)
        if (!rate) continue

        let [origin, destination] = pickWeighted(rand, routes) ?? [
          pick(rand, cityRows),
          pick(rand, cityRows)
        ]
        if (origin.id === destination.id) continue
        if (rand() < 0.5) [origin, destination] = [destination, origin]

        const load =
          rate.unit === 'liter'
            ? Math.round((vehicle.capacity * (0.6 + rand() * 0.4)) / 1000) * 1000
            : Math.max(1, Math.round(vehicle.capacity * (0.5 + rand() * 0.5)))
        const items = cargoItems(rand, cargoType, load, rate.unit)
        const bigTruck =
          vehicle.vehicleType === 'heavy_duty_truck' || vehicle.vehicleType === 'jumbo_truck'
        if (bigTruck && rand() < MIXED_TRUCK_SHARE) mixLoad(rand, items, 'containers')
        if (cargoType === 'fuel' && rand() < MIXED_TANKER_SHARE) mixLoad(rand, items, 'liquids')
        const quantity = totalInVehicleUnit(items)
        if (items.length === 0 || quantity <= 0) continue
        const distanceKm = estimateRoadKm(origin, destination)
        const priced = calculateItemsCost(items, rateList, distanceKm)
        const mainRate = priced?.mainType ? rates.get(priced.mainType) : undefined
        if (!priced || !mainRate) continue
        const tripCost = priced.total
        const taxes = calculateCharges(tripCost, chargeList, 'cargo')
        const taxAmount = taxes.total
        if (taxAmount <= 0) continue

        // Registered up to two days ahead of the trip, during working hours
        const createdAt = new Date(
          departureAt.getTime() - between(rand, 0, 2) * DAY_MS + between(rand, 7, 18) * 3_600_000
        )
        if (createdAt.getTime() > now) createdAt.setTime(now - between(rand, 1, 60) * 60_000)

        let status = statusFor(rand, ageDays)
        const billedAt = new Date(
          Math.min(now, createdAt.getTime() + between(rand, 5, 360) * 60_000)
        )
        const paidAt = new Date(billedAt.getTime() + between(rand, 10, 48 * 60) * 60_000)
        if (status === 'certified' && paidAt.getTime() > now) status = 'billed'

        const borderRoute = origin.name === 'Port Sudan' || destination.name === 'Port Sudan'
        const kindRoll = extra()
        const tripKind = borderRoute
          ? kindRoll < 0.45
            ? 'import'
            : kindRoll < 0.7
              ? 'export'
              : 'domestic'
          : kindRoll < 0.08
            ? 'export'
            : 'domestic'
        const trailerRoll = extra()
        const trailerCount = bigTruck ? (trailerRoll < 0.1 ? 2 : trailerRoll < 0.4 ? 1 : 0) : 0
        const driver = pick(extra, driversOf.get(vehicle.companyId) ?? [])
        const shipper = partyIn(origin)
        let receiver = partyIn(destination)
        while (receiver.name === shipper.name) receiver = partyIn(destination)
        // Trucks leave between 05:00 and 20:00
        const leavesAt = new Date(departureAt)
        leavesAt.setHours(between(times, 5, 20), pick(times, [0, 15, 30, 45]))
        const arrivesAt = suggestedArrival(leavesAt, distanceKm, TRUCK_KMH)
        const company = companyById.get(vehicle.companyId)!
        // Booked at the company's branch in the origin city, or else any of its branches
        const branch =
          company.branches.find((b) => b.cityId === origin.id) ?? pick(extra, company.branches)
        const billed = status !== 'draft'

        const [{ id: manifestId }] = await tx
          .insert(manifests)
          .values({
            vehicleId: vehicle.id,
            branchId: branch.id,
            createdBy: branch.clerkId,
            originCityId: origin.id,
            destinationCityId: destination.id,
            cargoType: mainRate.cargoType,
            cargoQuantity: quantity,
            cargoUnit: rate.unit,
            departureAt: leavesAt,
            arrivalAt: arrivesAt,
            distanceKm,
            ratePerKm: mainRate.ratePerKm,
            tripCost,
            taxAmount,
            status,
            tripKind,
            driverId: driver?.id ?? null,
            driverName: driver?.name ?? null,
            driverPhone: driver?.phone ?? null,
            shipperName: shipper.name,
            shipperAddress: shipper.address,
            shipperPhone: shipper.phone,
            receiverName: receiver.name,
            receiverAddress: receiver.address,
            receiverPhone: receiver.phone,
            carrierName: billed ? company.name : null,
            carrierAddress: billed ? company.address : null,
            carrierTin: billed ? company.tin : null,
            createdAt,
            updatedAt: status === 'draft' ? createdAt : status === 'billed' ? billedAt : paidAt
          })
          .returning({ id: manifests.id })
        itemRows.push(
          ...items.map((item, position) => ({
            manifestId,
            position,
            ...packed(extra, item),
            ratePerKm: rates.get(item.cargoType)?.ratePerKm ?? 0,
            perQuantity: rates.get(item.cargoType)?.perQuantity ?? 1,
            cost: priced.costs[position],
            createdAt,
            updatedAt: createdAt
          }))
        )
        trailerRows.push(
          ...Array.from({ length: trailerCount }, (_, position) => ({
            manifestId,
            position,
            plateNumber: uniqueTrailerPlate(),
            createdAt,
            updatedAt: createdAt
          }))
        )
        taxRows.push(
          ...taxes.lines.map((line, position) => ({
            manifestId,
            position,
            ...line,
            createdAt,
            updatedAt: createdAt
          }))
        )
        if (status === 'draft') continue

        const paid = status === 'certified'
        const billId = uniqueBillId(billedAt)
        const paymentRef = paid ? uniqueRef() : null
        simBillRows.push({
          billId,
          amount: taxAmount,
          status: paid ? 'paid' : 'pending',
          paymentRef,
          paidAt: paid ? paidAt : null,
          createdAt: billedAt,
          updatedAt: paid ? paidAt : billedAt
        })
        paymentRows.push({
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
        if (!paid) continue

        certificateRows.push({
          manifestId,
          certificateNo: certificateNoFor(manifestId, paidAt),
          manifestNo: manifestNoFor(manifestId, paidAt),
          qrToken: randomBytes(16).toString('hex'),
          issuedAt: paidAt,
          validUntil: validUntilFor(arrivesAt, DEFAULT_SETTINGS.validityMarginHours.cargo),
          createdAt: paidAt,
          updatedAt: paidAt
        })
      }
    }

    // Buses: one or two per company, each with a template for its usual route, and a year of
    // passenger trips
    const passengerRows: (typeof tripPassengers.$inferInsert)[] = []
    const ticketRate = await pricing.ticketRatePerKm(tx)
    const nationalIds = new Set<string>()
    const nationalId = (): string => {
      for (;;) {
        const id = `${between(pax, 1, 9)}${digits(pax, 10)}`
        if (nationalIds.has(id)) continue
        nationalIds.add(id)
        return id
      }
    }
    const busRoutes = BUS_ROUTES.flatMap(([a, b, weight]) => {
      const from = cityByName.get(a)
      const to = cityByName.get(b)
      return from && to ? [{ value: [from, to] as const, weight }] : []
    })
    const buses: {
      id: number
      companyId: number
      seats: number
      route: (typeof busRoutes)[number]['value']
    }[] = []
    for (const company of seeded) {
      for (let i = 0, count = between(pax, 1, 2); i < count; i++) {
        const seats = between(pax, 45, 50)
        const createdAt = new Date(today.getTime() - between(pax, HISTORY_DAYS, 500) * DAY_MS)
        const [{ id }] = await tx
          .insert(vehicles)
          .values({
            companyId: company.id,
            plateNumber: uniquePlate(),
            registrationNo: digits(pax, 7),
            vehicleType: 'bus',
            capacity: seats,
            capacityUnit: 'seat',
            createdAt,
            updatedAt: createdAt
          })
          .returning({ id: vehicles.id })
        const route = pickWeighted(pax, busRoutes)
        buses.push({ id, companyId: company.id, seats, route })
        const [from, to] = route
        const hour = pick(pax, [6, 7, 8, 18, 20])
        const distance = estimateRoadKm(from, to)
        await tx.insert(tripTemplates).values({
          companyId: company.id,
          branchId: (company.branches.find((b) => b.cityId === from.id) ?? company.branches[0]).id,
          name: `${from.nameAr ?? from.name} - ${to.nameAr ?? to.name} ${String(hour).padStart(2, '0')}:00`,
          originCityId: from.id,
          destinationCityId: to.id,
          vehicleId: id,
          driverId: pick(pax, driversOf.get(company.id) ?? [])?.id ?? null,
          departureTime: `${String(hour).padStart(2, '0')}:00`,
          durationMinutes: Math.ceil((distance / BUS_KMH) * 4) * 15
        })
      }
    }
    for (let ageDays = HISTORY_DAYS - 1; ageDays >= 0; ageDays--) {
      const day = new Date(today)
      day.setDate(today.getDate() - ageDays)
      for (const bus of buses) {
        if (pax() >= BUS_TRIP_SHARE) continue
        // Out on its usual route one day, back the next
        let [origin, destination] = bus.route
        if (pax() < 0.5) [origin, destination] = [destination, origin]
        const leavesAt = new Date(day)
        leavesAt.setHours(pick(pax, [6, 7, 8, 18, 20]), 0)
        const distanceKm = estimateRoadKm(origin, destination)
        const arrivesAt = suggestedArrival(leavesAt, distanceKm, BUS_KMH)
        const createdAt = new Date(
          leavesAt.getTime() - between(pax, 1, 3) * DAY_MS + between(pax, 0, 8) * 3_600_000
        )
        if (createdAt.getTime() > now) createdAt.setTime(now - between(pax, 1, 60) * 60_000)

        // Most seats sold; a few infants on their parents' laps and a few passport holders
        const sold = between(pax, Math.floor(bus.seats * 0.6), bus.seats)
        const passengers: PassengerRecord[] = Array.from({ length: sold }, (_, i) => {
          const woman = pax() < 0.45
          const first = pick(pax, woman ? WOMEN_FIRST_NAMES : DRIVER_FIRST_NAMES)
          const foreign = pax() < 0.05
          return {
            fullName: `${first} ${pick(pax, DRIVER_LAST_NAMES)}`,
            idType: foreign ? 'passport' : 'national_id',
            idNumber: foreign ? `P${digits(pax, 8)}` : nationalId(),
            seatNo: i + 1,
            isInfant: false,
            notes: foreign ? pick(pax, ['إريتري', 'إثيوبي', 'مصري', 'تشادي']) : null
          }
        })
        for (const parent of passengers.filter(() => pax() < 0.06)) {
          passengers.push({
            fullName: `${pick(pax, [...WOMEN_FIRST_NAMES, ...DRIVER_FIRST_NAMES])} ${parent.fullName.split(' ').slice(1).join(' ')}`,
            idType: null,
            idNumber: null,
            seatNo: parent.seatNo,
            isInfant: true,
            notes: 'رضيع'
          })
        }
        const ticketPrice = calculateTicketPrice(ticketRate, distanceKm)
        const tripCost = ticketPrice * sold
        const taxes = calculateCharges(tripCost, chargeList, 'passenger')
        const taxAmount = taxes.total
        if (taxAmount <= 0) continue

        let status = statusFor(pax, ageDays)
        const billedAt = new Date(
          Math.min(now, createdAt.getTime() + between(pax, 5, 120) * 60_000)
        )
        const paidAt = new Date(billedAt.getTime() + between(pax, 10, 12 * 60) * 60_000)
        if (status === 'certified' && paidAt.getTime() > now) status = 'billed'
        const company = companyById.get(bus.companyId)!
        const branch =
          company.branches.find((b) => b.cityId === origin.id) ?? pick(pax, company.branches)
        const driver = pick(pax, driversOf.get(bus.companyId) ?? [])
        const billed = status !== 'draft'

        const [{ id: manifestId }] = await tx
          .insert(manifests)
          .values({
            vehicleId: bus.id,
            branchId: branch.id,
            createdBy: branch.clerkId,
            originCityId: origin.id,
            destinationCityId: destination.id,
            category: 'passenger',
            cargoType: null,
            cargoQuantity: sold,
            cargoUnit: 'seat',
            departureAt: leavesAt,
            arrivalAt: arrivesAt,
            distanceKm,
            ratePerKm: ticketRate,
            ticketPrice,
            tripCost,
            taxAmount,
            status,
            tripKind: 'domestic',
            driverId: driver?.id ?? null,
            driverName: driver?.name ?? null,
            driverPhone: driver?.phone ?? null,
            carrierName: billed ? company.name : null,
            carrierAddress: billed ? company.address : null,
            carrierTin: billed ? company.tin : null,
            createdAt,
            updatedAt: status === 'draft' ? createdAt : status === 'billed' ? billedAt : paidAt
          })
          .returning({ id: manifests.id })
        passengerRows.push(
          ...passengers.map((p, position) => ({
            manifestId,
            position,
            ...p,
            createdAt,
            updatedAt: createdAt
          }))
        )
        taxRows.push(
          ...taxes.lines.map((line, position) => ({
            manifestId,
            position,
            ...line,
            createdAt,
            updatedAt: createdAt
          }))
        )
        if (status === 'draft') continue

        const paid = status === 'certified'
        const billId = uniqueBillId(billedAt)
        const paymentRef = paid ? uniqueRef() : null
        simBillRows.push({
          billId,
          amount: taxAmount,
          status: paid ? 'paid' : 'pending',
          paymentRef,
          paidAt: paid ? paidAt : null,
          createdAt: billedAt,
          updatedAt: paid ? paidAt : billedAt
        })
        paymentRows.push({
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
        if (!paid) continue
        certificateRows.push({
          manifestId,
          certificateNo: certificateNoFor(manifestId, paidAt),
          manifestNo: manifestNoFor(manifestId, paidAt, 'passenger'),
          qrToken: randomBytes(16).toString('hex'),
          issuedAt: paidAt,
          validUntil: validUntilFor(arrivesAt, DEFAULT_SETTINGS.validityMarginHours.passenger),
          createdAt: paidAt,
          updatedAt: paidAt
        })
      }
    }

    await insertInBatches(passengerRows, (rows) => tx.insert(tripPassengers).values(rows))
    await insertInBatches(itemRows, (rows) => tx.insert(manifestCargoItems).values(rows))
    await insertInBatches(trailerRows, (rows) => tx.insert(manifestTrailers).values(rows))
    await insertInBatches(taxRows, (rows) => tx.insert(manifestCharges).values(rows))
    await insertInBatches(simBillRows, (rows) => tx.insert(esaliSimBills).values(rows))
    await insertInBatches(paymentRows, (rows) => tx.insert(payments).values(rows))
    await insertInBatches(certificateRows, (rows) => tx.insert(certificates).values(rows))
  })
}

async function demoCompanyIds(): Promise<number[]> {
  const rows = await getDb()
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.isDemo, true))
  return rows.map((c) => c.id)
}

// Deletes the demo companies and everything that hangs off them (also what was added to one by
// hand: its trips, members, roles and branches), children first
async function deleteDemoCompanies(): Promise<void> {
  const companyIds = await demoCompanyIds()
  if (companyIds.length === 0) return
  // Members' sessions go with the accounts (sessions.user_id cascades), roles' permissions with
  // the roles

  // Folders of demo trips that had attachments, removed once the rows are gone for good
  const folders = await getDb().transaction(async (tx) => {
    const demoVehicles = tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(inArray(vehicles.companyId, companyIds))
    const demoManifests = tx
      .select({ id: manifests.id })
      .from(manifests)
      .where(inArray(manifests.vehicleId, demoVehicles))
    const demoBills = tx
      .select({ billId: payments.billId })
      .from(payments)
      .where(inArray(payments.manifestId, demoManifests))

    await tx.delete(esaliSimBills).where(inArray(esaliSimBills.billId, demoBills))
    await tx.delete(certificates).where(inArray(certificates.manifestId, demoManifests))
    await tx.delete(manifestCargoItems).where(inArray(manifestCargoItems.manifestId, demoManifests))
    await tx.delete(tripPassengers).where(inArray(tripPassengers.manifestId, demoManifests))
    await tx.delete(manifestCharges).where(inArray(manifestCharges.manifestId, demoManifests))
    await tx.delete(manifestTrailers).where(inArray(manifestTrailers.manifestId, demoManifests))
    // Files attached by hand to a demo company's trips go too
    const attached = await tx
      .selectDistinct({ manifestId: tripDocuments.manifestId })
      .from(tripDocuments)
      .where(inArray(tripDocuments.manifestId, demoManifests))
    await tx.delete(tripDocuments).where(inArray(tripDocuments.manifestId, demoManifests))
    await tx.delete(payments).where(inArray(payments.manifestId, demoManifests))
    await tx.delete(manifests).where(inArray(manifests.vehicleId, demoVehicles))
    await tx.delete(tripTemplates).where(inArray(tripTemplates.companyId, companyIds))
    await tx.delete(vehicles).where(inArray(vehicles.companyId, companyIds))
    await tx.delete(drivers).where(inArray(drivers.companyId, companyIds))
    await tx.delete(users).where(inArray(users.companyId, companyIds))
    await tx.delete(roles).where(inArray(roles.companyId, companyIds))
    await tx.delete(branches).where(inArray(branches.companyId, companyIds))
    await tx.delete(companies).where(inArray(companies.id, companyIds))
    return attached.map((a) => a.manifestId)
  })
  // A folder that can't be removed now is picked up by removeOrphanFolders on the next startup
  for (const manifestId of folders) {
    try {
      removeTripFolder(manifestId)
    } catch (err) {
      log.error('Removing demo trip documents failed:', err)
    }
  }
}

// On startup: seed once if there are no demo companies yet, and make sure the demo government
// accounts exist
export async function ensureDemoData(): Promise<void> {
  if ((await demoCompanyIds()).length === 0) await seedCompanies()
  await createGovtAccounts()
}

// Government panel "Regenerate demo data": rebuilds the demo companies; other companies' data
// stays
export async function regenerateDemoData(): Promise<void> {
  if (!config.demoMode) throw new Error('Demo data can only be regenerated in demo mode')
  await deleteDemoCompanies()
  await seedCompanies()
  await createGovtAccounts()
}
