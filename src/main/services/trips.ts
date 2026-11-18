import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import {
  cities,
  getDb,
  manifestCargoItems,
  manifests,
  manifestTaxes,
  taxRates,
  taxSettings,
  vehicles
} from '../db'
import {
  CARGO_TYPES,
  ITEM_UNITS,
  MAX_CARGO_ITEMS,
  MAX_ITEM_NAME_LENGTH,
  itemUnitsFor,
  totalInVehicleUnit,
  type CargoItem,
  type CargoItemRecord,
  type CargoType,
  type FleetErrorCode,
  type FleetResult,
  type ItemUnit,
  type QuantityUnit,
  type TripInput,
  type TripRecord,
  type TripReferenceData
} from '../../shared/fleet'
import {
  calculateItemsCost,
  calculateTaxes,
  estimateRoadKm,
  isFeeCode,
  isTaxCode,
  type FeeSetting,
  type TaxLine,
  type TaxSetting
} from '../../shared/tax'
import { findOwnedVehicle } from './fleet'

const isCargoType = (value: unknown): value is CargoType =>
  (CARGO_TYPES as readonly unknown[]).includes(value)
const isItemUnit = (value: unknown): value is ItemUnit =>
  (ITEM_UNITS as readonly unknown[]).includes(value)

// "YYYY-MM-DD" as local midnight, or null if it isn't a real calendar date
function parseTripDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(year, month - 1, day)
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

type Db = ReturnType<typeof getDb>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

const settingRows = (db: Db | Tx): (typeof taxSettings.$inferSelect)[] =>
  db.select().from(taxSettings).all()

export const getTaxSettings = (db: Db | Tx = getDb()): TaxSetting[] =>
  settingRows(db).flatMap(({ code, rateBps }) =>
    isTaxCode(code) && rateBps !== null ? [{ code, rateBps }] : []
  )

export const getFeeSettings = (db: Db | Tx = getDb()): FeeSetting[] =>
  settingRows(db).flatMap(({ code, amount }) =>
    isFeeCode(code) && amount !== null ? [{ code, amount }] : []
  )

export function getReferenceData(): TripReferenceData {
  const db = getDb()
  return {
    cities: db
      .select({
        id: cities.id,
        name: cities.name,
        nameAr: cities.nameAr,
        state: cities.state,
        lat: cities.lat,
        lng: cities.lng
      })
      .from(cities)
      .orderBy(cities.name)
      .all(),
    taxRates: db
      .select({
        cargoType: taxRates.cargoType,
        ratePerKm: taxRates.ratePerKm,
        unit: taxRates.unit,
        perQuantity: taxRates.perQuantity
      })
      .from(taxRates)
      .all(),
    taxSettings: getTaxSettings(db),
    feeSettings: getFeeSettings(db)
  }
}

// Columns of a TripRecord except its items and taxes; select from manifests joined with vehicles
export const tripColumns = {
  id: manifests.id,
  vehicleId: manifests.vehicleId,
  plateNumber: vehicles.plateNumber,
  vehicleType: vehicles.vehicleType,
  originCityId: manifests.originCityId,
  destinationCityId: manifests.destinationCityId,
  cargoType: manifests.cargoType,
  cargoQuantity: manifests.cargoQuantity,
  cargoUnit: manifests.cargoUnit,
  tripDate: manifests.tripDate,
  distanceKm: manifests.distanceKm,
  ratePerKm: manifests.ratePerKm,
  tripCost: manifests.tripCost,
  taxAmount: manifests.taxAmount,
  status: manifests.status,
  createdAt: manifests.createdAt
}

export type TripRow = Omit<TripRecord, 'tripDate' | 'createdAt' | 'items' | 'taxes'> & {
  tripDate: Date
  createdAt: Date
}

// Adds the cargo items and tax lines to manifest rows, with one query per table
export function toTripRecords(rows: readonly TripRow[]): TripRecord[] {
  if (rows.length === 0) return []
  const db = getDb()
  const ids = rows.map((r) => r.id)
  const items = new Map<number, CargoItemRecord[]>()
  for (const item of db
    .select()
    .from(manifestCargoItems)
    .where(inArray(manifestCargoItems.manifestId, ids))
    .orderBy(asc(manifestCargoItems.position))
    .all()) {
    const list = items.get(item.manifestId) ?? []
    list.push({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      cargoType: item.cargoType,
      ratePerKm: item.ratePerKm,
      perQuantity: item.perQuantity,
      cost: item.cost
    })
    items.set(item.manifestId, list)
  }
  const taxes = new Map<number, TaxLine[]>()
  for (const line of db
    .select()
    .from(manifestTaxes)
    .where(inArray(manifestTaxes.manifestId, ids))
    .orderBy(asc(manifestTaxes.id))
    .all()) {
    const list = taxes.get(line.manifestId) ?? []
    list.push({ code: line.code, rateBps: line.rateBps, amount: line.amount })
    taxes.set(line.manifestId, list)
  }
  return rows.map((row) => ({
    ...row,
    tripDate: row.tripDate.getTime(),
    createdAt: row.createdAt.getTime(),
    items: items.get(row.id) ?? [],
    taxes: taxes.get(row.id) ?? []
  }))
}

export const toTripRecord = (row: TripRow): TripRecord => toTripRecords([row])[0]

export function listTrips(ownerId: number): TripRecord[] {
  return toTripRecords(
    getDb()
      .select(tripColumns)
      .from(manifests)
      .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
      .where(eq(vehicles.ownerId, ownerId))
      .orderBy(desc(manifests.createdAt), desc(manifests.id))
      .all()
  )
}

// Items from the renderer, trimmed and checked; null if any of them is invalid
function parseItems(value: unknown, vehicleUnit: QuantityUnit): CargoItem[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CARGO_ITEMS) return null
  const allowed = itemUnitsFor(vehicleUnit)
  const items: CargoItem[] = []
  for (const raw of value) {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
    const quantity = raw?.quantity
    if (!name || name.length > MAX_ITEM_NAME_LENGTH) return null
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) return null
    if (!isItemUnit(raw?.unit) || !allowed.includes(raw.unit)) return null
    if (!isCargoType(raw?.cargoType)) return null
    items.push({ name, quantity, unit: raw.unit, cargoType: raw.cargoType })
  }
  return items
}

interface BuiltTrip {
  manifest: Omit<typeof manifests.$inferInsert, 'status'>
  items: CargoItemRecord[]
  taxes: TaxLine[]
}

// Validates a trip and computes its cost and taxes from the DB; the renderer's preview is never
// trusted
function buildTrip(ownerId: number, input: TripInput): FleetResult<BuiltTrip> {
  if (!input) return { ok: false, error: 'missing_fields' }

  const vehicle = findOwnedVehicle(ownerId, input.vehicleId)
  if (!vehicle) return { ok: false, error: 'vehicle_not_found' }

  if (input.originCityId === input.destinationCityId) return { ok: false, error: 'same_route' }
  const db = getDb()
  const route = db
    .select()
    .from(cities)
    .where(inArray(cities.id, [input.originCityId, input.destinationCityId]))
    .all()
  const origin = route.find((c) => c.id === input.originCityId)
  const destination = route.find((c) => c.id === input.destinationCityId)
  if (!origin || !destination) return { ok: false, error: 'city_not_found' }

  const items = parseItems(input.items, vehicle.capacityUnit)
  if (!items) return { ok: false, error: 'invalid_items' }
  const rates = db.select().from(taxRates).all()
  // Each item is measured in its rate's unit, which has to match what the vehicle carries
  for (const item of items) {
    const rate = rates.find((r) => r.cargoType === item.cargoType)
    if (!rate) return { ok: false, error: 'invalid_items' }
    if (rate.unit !== vehicle.capacityUnit) return { ok: false, error: 'unit_mismatch' }
  }
  const quantity = totalInVehicleUnit(items)
  if (!(quantity > 0)) return { ok: false, error: 'invalid_quantity' }
  if (quantity > vehicle.capacity) return { ok: false, error: 'over_capacity' }

  const tripDate = parseTripDate(input.tripDate)
  if (!tripDate) return { ok: false, error: 'invalid_date' }

  const distanceKm = estimateRoadKm(origin, destination)
  const priced = calculateItemsCost(items, rates, distanceKm)
  if (!priced || !priced.mainType) return { ok: false, error: 'unknown' }
  const mainRate = rates.find((r) => r.cargoType === priced.mainType)
  if (!mainRate) return { ok: false, error: 'unknown' }
  const tripCost = priced.total
  const taxes = calculateTaxes(tripCost, getTaxSettings(db), getFeeSettings(db))
  return {
    ok: true,
    data: {
      manifest: {
        vehicleId: vehicle.id,
        originCityId: origin.id,
        destinationCityId: destination.id,
        cargoType: priced.mainType,
        cargoQuantity: quantity,
        cargoUnit: vehicle.capacityUnit,
        tripDate,
        distanceKm,
        ratePerKm: mainRate.ratePerKm,
        tripCost,
        taxAmount: taxes.total
      },
      items: items.map((item, index) => {
        const rate = rates.find((r) => r.cargoType === item.cargoType)
        return {
          ...item,
          ratePerKm: rate?.ratePerKm ?? 0,
          perQuantity: rate?.perQuantity ?? 1,
          cost: priced.costs[index]
        }
      }),
      taxes: taxes.lines
    }
  }
}

function writeItems(tx: Tx, manifestId: number, items: readonly CargoItemRecord[]): void {
  tx.delete(manifestCargoItems).where(eq(manifestCargoItems.manifestId, manifestId)).run()
  tx.insert(manifestCargoItems)
    .values(items.map((item, position) => ({ manifestId, position, ...item })))
    .run()
}

// Replaces a manifest's tax lines (drafts reprice; billing freezes them)
export function writeTaxes(tx: Tx, manifestId: number, lines: readonly TaxLine[]): void {
  tx.delete(manifestTaxes).where(eq(manifestTaxes.manifestId, manifestId)).run()
  tx.insert(manifestTaxes)
    .values(lines.map((line) => ({ manifestId, ...line })))
    .run()
}

function findOwnedTripRow(ownerId: number, manifestId: unknown): TripRow | undefined {
  if (typeof manifestId !== 'number') return undefined
  return getDb()
    .select(tripColumns)
    .from(manifests)
    .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
    .where(and(eq(manifests.id, manifestId), eq(vehicles.ownerId, ownerId)))
    .get()
}

const failure = (error: FleetErrorCode): FleetResult<never> => ({ ok: false, error })

// Saves a new trip as a draft
export function createTrip(ownerId: number, input: TripInput): FleetResult<TripRecord> {
  const built = buildTrip(ownerId, input)
  if (!built.ok) return built
  const { manifest, items, taxes } = built.data

  const id = getDb().transaction((tx) => {
    const { id } = tx
      .insert(manifests)
      .values({ ...manifest, status: 'draft' })
      .returning({ id: manifests.id })
      .get()
    writeItems(tx, id, items)
    writeTaxes(tx, id, taxes)
    return id
  })
  const row = findOwnedTripRow(ownerId, id)
  return row ? { ok: true, data: toTripRecord(row) } : failure('unknown')
}

// Edits a draft trip; once its bill is issued the trip is fixed
export function updateTrip(
  ownerId: number,
  manifestId: number,
  input: TripInput
): FleetResult<TripRecord> {
  const existing = findOwnedTripRow(ownerId, manifestId)
  if (!existing) return failure('manifest_not_found')
  if (existing.status !== 'draft') return failure('not_draft')

  const built = buildTrip(ownerId, input)
  if (!built.ok) return built
  const { manifest, items, taxes } = built.data

  getDb().transaction((tx) => {
    // Re-checked inside the transaction so a bill issued meanwhile can't be overwritten
    const current = tx
      .select({ status: manifests.status })
      .from(manifests)
      .where(eq(manifests.id, existing.id))
      .get()
    if (current?.status !== 'draft') return
    tx.update(manifests).set(manifest).where(eq(manifests.id, existing.id)).run()
    writeItems(tx, existing.id, items)
    writeTaxes(tx, existing.id, taxes)
  })
  const row = findOwnedTripRow(ownerId, existing.id)
  if (!row) return failure('manifest_not_found')
  if (row.status !== 'draft') return failure('not_draft')
  return { ok: true, data: toTripRecord(row) }
}

// Deletes a draft trip for good; once its bill is issued the trip is part of the record
export function deleteTrip(ownerId: number, manifestId: number): FleetResult<null> {
  const existing = findOwnedTripRow(ownerId, manifestId)
  if (!existing) return failure('manifest_not_found')
  if (existing.status !== 'draft') return failure('not_draft')

  const deleted = getDb().transaction((tx) => {
    // Re-checked inside the transaction so a bill issued meanwhile isn't lost
    const current = tx
      .select({ status: manifests.status })
      .from(manifests)
      .where(eq(manifests.id, existing.id))
      .get()
    if (current?.status !== 'draft') return false
    tx.delete(manifestCargoItems).where(eq(manifestCargoItems.manifestId, existing.id)).run()
    tx.delete(manifestTaxes).where(eq(manifestTaxes.manifestId, existing.id)).run()
    tx.delete(manifests).where(eq(manifests.id, existing.id)).run()
    return true
  })
  return deleted ? { ok: true, data: null } : failure('not_draft')
}
