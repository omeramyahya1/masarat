import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { log } from '../log'
import {
  branches,
  cities,
  getDb,
  manifestCargoItems,
  manifests,
  manifestCharges,
  manifestTrailers,
  states,
  tripDocuments,
  vehicles
} from '../db'
import {
  CARGO_TYPES,
  ITEM_UNITS,
  MAX_CARGO_ITEMS,
  MAX_ITEM_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_PACKAGE_COUNT,
  MAX_PACKING_LENGTH,
  MAX_PARTY_ADDRESS_LENGTH,
  MAX_PARTY_NAME_LENGTH,
  MAX_TRAILERS,
  TRIP_KINDS,
  documentTypesFor,
  itemUnitsFor,
  normalizePhone,
  totalInVehicleUnit,
  type CargoItem,
  type CargoItemRecord,
  type CargoType,
  type FleetErrorCode,
  type FleetResult,
  type ItemUnit,
  type Party,
  type QuantityUnit,
  type TripInput,
  type TripKind,
  type TripRecord,
  type TripReferenceData,
  type TripDocumentRecord,
  type TripSuggestions
} from '@masarat/shared/fleet'
import { normalizePlate } from '@masarat/shared/plate'
import { calculateCharges, estimateRoadKm, type TaxLine } from '@masarat/shared/tax'
import {
  findStaged,
  isDocumentType,
  moveStaged,
  removeStoredFiles,
  removeTripFolder
} from './documents'
import { tripScopeCondition, type CompanyScope } from './access'
import { listCharges } from './charges'
import { findOwnedDriver } from './drivers'
import { findOwnedVehicle } from './fleet'
import { pricing } from './pricing'

const isCargoType = (value: unknown): value is CargoType =>
  (CARGO_TYPES as readonly unknown[]).includes(value)
const isItemUnit = (value: unknown): value is ItemUnit =>
  (ITEM_UNITS as readonly unknown[]).includes(value)
const isTripKind = (value: unknown): value is TripKind =>
  (TRIP_KINDS as readonly unknown[]).includes(value)
const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

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

export type { Tx }

export async function getReferenceData(): Promise<TripReferenceData> {
  const db = getDb()
  return {
    cities: await db
      .select({
        id: cities.id,
        name: cities.name,
        nameAr: cities.nameAr,
        state: states.name,
        stateAr: states.nameAr,
        lat: cities.lat,
        lng: cities.lng
      })
      .from(cities)
      .innerJoin(states, eq(cities.stateId, states.id))
      .orderBy(cities.name),
    cargoRates: await pricing.cargoRates(db),
    ticketRatePerKm: await pricing.ticketRatePerKm(db),
    charges: await listCharges(db)
  }
}

// Columns of a TripRecord except its items and taxes; select from manifests joined with vehicles
export const tripColumns = {
  id: manifests.id,
  vehicleId: manifests.vehicleId,
  branchId: manifests.branchId,
  branchName: sql<string>`(select ${branches.name} from ${branches} where ${branches.id} = ${manifests.branchId})`,
  plateNumber: vehicles.plateNumber,
  vehicleType: vehicles.vehicleType,
  registrationNo: vehicles.registrationNo,
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
  createdAt: manifests.createdAt,
  tripKind: manifests.tripKind,
  driverId: manifests.driverId,
  driverName: manifests.driverName,
  driverPhone: manifests.driverPhone,
  shipperName: manifests.shipperName,
  shipperAddress: manifests.shipperAddress,
  shipperPhone: manifests.shipperPhone,
  receiverName: manifests.receiverName,
  receiverAddress: manifests.receiverAddress,
  receiverPhone: manifests.receiverPhone,
  carrierName: manifests.carrierName,
  carrierAddress: manifests.carrierAddress,
  carrierTin: manifests.carrierTin
}

type NestedFields =
  'items' | 'taxes' | 'trailers' | 'shipper' | 'receiver' | 'carrier' | 'documents'
export type TripRow = Omit<TripRecord, 'tripDate' | 'createdAt' | NestedFields> & {
  tripDate: Date
  createdAt: Date
  shipperName: string | null
  shipperAddress: string | null
  shipperPhone: string | null
  receiverName: string | null
  receiverAddress: string | null
  receiverPhone: string | null
  carrierName: string | null
  carrierAddress: string | null
  carrierTin: string | null
}

const party = (name: string | null, address: string | null, phone: string | null): Party => ({
  name: name ?? '',
  address: address ?? '',
  phone: phone ?? ''
})

// Adds the cargo items, tax lines and trailers to manifest rows, with one query per table
export async function toTripRecords(rows: readonly TripRow[]): Promise<TripRecord[]> {
  if (rows.length === 0) return []
  const db = getDb()
  const ids = rows.map((r) => r.id)
  const [itemRows, lineRows, trailerRows, documentRows] = await Promise.all([
    db
      .select()
      .from(manifestCargoItems)
      .where(inArray(manifestCargoItems.manifestId, ids))
      .orderBy(asc(manifestCargoItems.position)),
    db
      .select()
      .from(manifestCharges)
      .where(inArray(manifestCharges.manifestId, ids))
      .orderBy(asc(manifestCharges.position), asc(manifestCharges.id)),
    db
      .select()
      .from(manifestTrailers)
      .where(inArray(manifestTrailers.manifestId, ids))
      .orderBy(asc(manifestTrailers.position)),
    db
      .select()
      .from(tripDocuments)
      .where(inArray(tripDocuments.manifestId, ids))
      .orderBy(asc(tripDocuments.id))
  ])
  const items = new Map<number, CargoItemRecord[]>()
  for (const item of itemRows) {
    const list = items.get(item.manifestId) ?? []
    list.push({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      cargoType: item.cargoType,
      ratePerKm: item.ratePerKm,
      perQuantity: item.perQuantity,
      cost: item.cost,
      packingType: item.packingType,
      packageCount: item.packageCount,
      notes: item.notes
    })
    items.set(item.manifestId, list)
  }
  const taxes = new Map<number, TaxLine[]>()
  for (const line of lineRows) {
    const list = taxes.get(line.manifestId) ?? []
    list.push({
      code: line.code,
      name: line.name,
      nameAr: line.nameAr,
      rateBps: line.rateBps,
      amount: line.amount
    })
    taxes.set(line.manifestId, list)
  }
  const trailers = new Map<number, string[]>()
  for (const trailer of trailerRows) {
    trailers.set(trailer.manifestId, [
      ...(trailers.get(trailer.manifestId) ?? []),
      trailer.plateNumber
    ])
  }
  const documents = new Map<number, TripDocumentRecord[]>()
  for (const document of documentRows) {
    documents.set(document.manifestId, [
      ...(documents.get(document.manifestId) ?? []),
      {
        id: document.id,
        docType: document.docType,
        fileName: document.fileName,
        size: document.size,
        createdAt: document.createdAt.getTime()
      }
    ])
  }
  return rows.map((row) => {
    const {
      shipperName,
      shipperAddress,
      shipperPhone,
      receiverName,
      receiverAddress,
      receiverPhone,
      carrierName,
      carrierAddress,
      carrierTin,
      ...rest
    } = row
    return {
      ...rest,
      tripDate: row.tripDate.getTime(),
      createdAt: row.createdAt.getTime(),
      items: items.get(row.id) ?? [],
      taxes: taxes.get(row.id) ?? [],
      trailers: trailers.get(row.id) ?? [],
      documents: documents.get(row.id) ?? [],
      shipper: party(shipperName, shipperAddress, shipperPhone),
      receiver: party(receiverName, receiverAddress, receiverPhone),
      carrier:
        carrierName !== null
          ? { name: carrierName, address: carrierAddress ?? '', tin: carrierTin ?? '' }
          : null
    }
  })
}

export const toTripRecord = async (row: TripRow): Promise<TripRecord> =>
  (await toTripRecords([row]))[0]

export async function listTrips(scope: CompanyScope): Promise<TripRecord[]> {
  return toTripRecords(
    await getDb()
      .select(tripColumns)
      .from(manifests)
      .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
      .where(tripScopeCondition(scope))
      .orderBy(desc(manifests.createdAt), desc(manifests.id))
  )
}

// Items from the browser, trimmed and checked; null if any of them is invalid. The packing type
// and package count may be empty on a draft.
function parseItems(value: unknown, vehicleUnit: QuantityUnit): CargoItem[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CARGO_ITEMS) return null
  const allowed = itemUnitsFor(vehicleUnit)
  const items: CargoItem[] = []
  for (const raw of value) {
    const name = asText(raw?.name)
    const quantity = raw?.quantity
    if (!name || name.length > MAX_ITEM_NAME_LENGTH) return null
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) return null
    if (!isItemUnit(raw?.unit) || !allowed.includes(raw.unit)) return null
    if (!isCargoType(raw?.cargoType)) return null
    const packingType = asText(raw?.packingType)
    const notes = asText(raw?.notes)
    if (packingType.length > MAX_PACKING_LENGTH || notes.length > MAX_NOTES_LENGTH) return null
    const packageCount = raw?.packageCount ?? null
    if (
      packageCount !== null &&
      (!Number.isInteger(packageCount) || packageCount <= 0 || packageCount > MAX_PACKAGE_COUNT)
    ) {
      return null
    }
    items.push({
      name,
      quantity,
      unit: raw.unit,
      cargoType: raw.cargoType,
      packingType: packingType || null,
      packageCount,
      notes: notes || null
    })
  }
  return items
}

// A sender or receiver: every field may be empty on a draft, but a phone has to be valid
function parseParty(value: unknown): Party | null {
  const raw = value as Partial<Party> | null | undefined
  const name = asText(raw?.name)
  const address = asText(raw?.address)
  const rawPhone = asText(raw?.phone)
  if (name.length > MAX_PARTY_NAME_LENGTH || address.length > MAX_PARTY_ADDRESS_LENGTH) return null
  const phone = rawPhone ? normalizePhone(rawPhone) : ''
  if (phone === null) return null
  return { name, address, phone }
}

// Trailer plates: valid, at most MAX_TRAILERS, all different and not the vehicle's own plate
function parseTrailers(value: unknown, headPlate: string): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_TRAILERS) return null
  const plates = value.map((plate) => (typeof plate === 'string' ? normalizePlate(plate) : null))
  if (plates.some((plate) => plate === null)) return null
  const unique = new Set([headPlate, ...(plates as string[])])
  return unique.size === plates.length + 1 ? (plates as string[]) : null
}

type StagedFile = NonNullable<ReturnType<typeof findStaged>>

// The trip's attachments after the save: saved ones it keeps (by id) and staged ones it adds
interface DocumentChanges {
  keep: number[]
  add: StagedFile[]
}

interface BuiltTrip {
  manifest: Omit<typeof manifests.$inferInsert, 'status'>
  items: CargoItemRecord[]
  taxes: TaxLine[]
  trailers: string[]
  documents: DocumentChanges
}

// Attachments from the browser: at most one per type, each type applying to the trip's kind,
// kept ones belonging to this trip and new ones still in staging
async function parseDocuments(
  userId: number,
  value: unknown,
  tripKind: TripKind,
  manifestId: number | null
): Promise<DocumentChanges | null> {
  if (value === undefined) return { keep: [], add: [] }
  if (!Array.isArray(value)) return null
  const allowed = documentTypesFor(tripKind)
  const saved =
    manifestId === null
      ? []
      : await getDb()
          .select({ id: tripDocuments.id, docType: tripDocuments.docType })
          .from(tripDocuments)
          .where(eq(tripDocuments.manifestId, manifestId))
  const seen = new Set<string>()
  const changes: DocumentChanges = { keep: [], add: [] }
  for (const raw of value) {
    if (!isDocumentType(raw?.docType) || !allowed.includes(raw.docType)) return null
    if (seen.has(raw.docType)) return null
    seen.add(raw.docType)
    if (typeof raw.id === 'number') {
      if (!saved.some((d) => d.id === raw.id && d.docType === raw.docType)) return null
      changes.keep.push(raw.id)
    } else {
      const file = findStaged(userId, raw.token)
      if (!file || file.docType !== raw.docType) return null
      changes.add.push(file)
    }
  }
  return changes
}

// Validates a trip and computes its cost and taxes from the DB; the portal's preview is never
// trusted
async function buildTrip(
  scope: CompanyScope,
  userId: number,
  input: TripInput,
  manifestId: number | null = null
): Promise<FleetResult<BuiltTrip>> {
  if (!input) return { ok: false, error: 'missing_fields' }

  // A branch member books at their own branch; anyone else picks one of the company's
  const branchId = scope.branchId ?? (typeof input.branchId === 'number' ? input.branchId : null)
  if (branchId === null) return { ok: false, error: 'branch_required' }
  const [branch] = await getDb()
    .select({ active: branches.active })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.companyId, scope.companyId)))
    .limit(1)
  if (!branch) return { ok: false, error: 'branch_not_found' }
  if (!branch.active) return { ok: false, error: 'branch_inactive' }

  const vehicle = await findOwnedVehicle(scope.companyId, input.vehicleId)
  if (!vehicle) return { ok: false, error: 'vehicle_not_found' }

  if (input.originCityId === input.destinationCityId) return { ok: false, error: 'same_route' }
  const db = getDb()
  const route = await db
    .select()
    .from(cities)
    .where(inArray(cities.id, [input.originCityId, input.destinationCityId]))
  const origin = route.find((c) => c.id === input.originCityId)
  const destination = route.find((c) => c.id === input.destinationCityId)
  if (!origin || !destination) return { ok: false, error: 'city_not_found' }

  const items = parseItems(input.items, vehicle.capacityUnit)
  if (!items) return { ok: false, error: 'invalid_items' }
  const rates = await pricing.cargoRates(db)
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

  if (!isTripKind(input.tripKind)) return { ok: false, error: 'missing_fields' }
  const trailers = parseTrailers(input.trailers, vehicle.plateNumber)
  if (!trailers) return { ok: false, error: 'invalid_trailer' }
  const shipper = parseParty(input.shipper)
  const receiver = parseParty(input.receiver)
  if (!shipper || !receiver) return { ok: false, error: 'invalid_party' }
  // The manifest keeps a copy of the driver's name and phone
  const driverId = input.driverId ?? null
  const driver = driverId === null ? null : await findOwnedDriver(scope.companyId, driverId)
  if (driverId !== null && !driver) return { ok: false, error: 'driver_not_found' }
  const documents = await parseDocuments(userId, input.documents, input.tripKind, manifestId)
  if (!documents) return { ok: false, error: 'invalid_document' }

  const distanceKm = estimateRoadKm(origin, destination)
  const priced = await pricing.cargoCost(items, distanceKm, db)
  if (!priced || !priced.mainType) return { ok: false, error: 'unknown' }
  const mainRate = rates.find((r) => r.cargoType === priced.mainType)
  if (!mainRate) return { ok: false, error: 'unknown' }
  const tripCost = priced.total
  const taxes = calculateCharges(tripCost, await listCharges(db), 'cargo')
  return {
    ok: true,
    data: {
      manifest: {
        vehicleId: vehicle.id,
        branchId,
        originCityId: origin.id,
        destinationCityId: destination.id,
        cargoType: priced.mainType,
        cargoQuantity: quantity,
        cargoUnit: vehicle.capacityUnit,
        tripDate,
        distanceKm,
        ratePerKm: mainRate.ratePerKm,
        tripCost,
        taxAmount: taxes.total,
        tripKind: input.tripKind,
        driverId: driver?.id ?? null,
        driverName: driver?.name ?? null,
        driverPhone: driver?.phone ?? null,
        shipperName: shipper.name || null,
        shipperAddress: shipper.address || null,
        shipperPhone: shipper.phone || null,
        receiverName: receiver.name || null,
        receiverAddress: receiver.address || null,
        receiverPhone: receiver.phone || null
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
      taxes: taxes.lines,
      trailers,
      documents
    }
  }
}

async function writeItems(
  tx: Tx,
  manifestId: number,
  items: readonly CargoItemRecord[]
): Promise<void> {
  await tx.delete(manifestCargoItems).where(eq(manifestCargoItems.manifestId, manifestId))
  await tx
    .insert(manifestCargoItems)
    .values(items.map((item, position) => ({ manifestId, position, ...item })))
}

async function writeTrailers(
  tx: Tx,
  manifestId: number,
  trailers: readonly string[]
): Promise<void> {
  await tx.delete(manifestTrailers).where(eq(manifestTrailers.manifestId, manifestId))
  if (trailers.length === 0) return
  await tx
    .insert(manifestTrailers)
    .values(trailers.map((plateNumber, position) => ({ manifestId, position, plateNumber })))
}

async function insertDocuments(
  tx: Tx,
  manifestId: number,
  files: readonly StagedFile[]
): Promise<void> {
  if (files.length === 0) return
  await tx.insert(tripDocuments).values(
    files.map((file) => ({
      manifestId,
      docType: file.docType,
      fileName: file.fileName,
      storedName: file.storedName,
      size: file.size
    }))
  )
}

// Replaces a manifest's tax lines (drafts reprice; billing freezes them)
export async function writeCharges(
  tx: Tx,
  manifestId: number,
  lines: readonly TaxLine[]
): Promise<void> {
  await tx.delete(manifestCharges).where(eq(manifestCharges.manifestId, manifestId))
  if (lines.length === 0) return
  await tx
    .insert(manifestCharges)
    .values(lines.map((line, position) => ({ manifestId, position, ...line })))
}

async function findOwnedTripRow(
  scope: CompanyScope,
  manifestId: unknown
): Promise<TripRow | undefined> {
  if (typeof manifestId !== 'number') return undefined
  const [row] = await getDb()
    .select(tripColumns)
    .from(manifests)
    .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
    .where(and(eq(manifests.id, manifestId), tripScopeCondition(scope)))
    .limit(1)
  return row
}

// The manifest's status, read with a row lock so a concurrent save, delete or bill waits
async function lockedStatus(tx: Tx, manifestId: number): Promise<string | undefined> {
  const [current] = await tx
    .select({ status: manifests.status })
    .from(manifests)
    .where(eq(manifests.id, manifestId))
    .for('update')
  return current?.status
}

const failure = (error: FleetErrorCode): FleetResult<never> => ({ ok: false, error })

// Saves a new trip as a draft
export async function createTrip(
  scope: CompanyScope,
  userId: number,
  input: TripInput
): Promise<FleetResult<TripRecord>> {
  const built = await buildTrip(scope, userId, input)
  if (!built.ok) return built
  const { manifest, items, taxes, trailers, documents } = built.data

  const id = await getDb().transaction(async (tx) => {
    const [{ id }] = await tx
      .insert(manifests)
      .values({ ...manifest, createdBy: userId, status: 'draft' })
      .returning({ id: manifests.id })
    await writeItems(tx, id, items)
    await writeCharges(tx, id, taxes)
    await writeTrailers(tx, id, trailers)
    await insertDocuments(tx, id, documents.add)
    return id
  })
  moveStaged(id, documents.add)
  const row = await findOwnedTripRow(scope, id)
  return row ? { ok: true, data: await toTripRecord(row) } : failure('unknown')
}

// Edits a draft trip; once its bill is issued the trip is fixed
export async function updateTrip(
  scope: CompanyScope,
  userId: number,
  manifestId: number,
  input: TripInput
): Promise<FleetResult<TripRecord>> {
  const existing = await findOwnedTripRow(scope, manifestId)
  if (!existing) return failure('manifest_not_found')
  if (existing.status !== 'draft') return failure('not_draft')

  const built = await buildTrip(scope, userId, input, existing.id)
  if (!built.ok) return built
  const { manifest, items, taxes, trailers, documents } = built.data

  // Attachments the trip no longer has; their files are removed once the rows are gone
  const removed = await getDb().transaction(async (tx) => {
    // Re-checked inside the transaction so a bill issued meanwhile can't be overwritten
    if ((await lockedStatus(tx, existing.id)) !== 'draft') return null
    await tx.update(manifests).set(manifest).where(eq(manifests.id, existing.id))
    await writeItems(tx, existing.id, items)
    await writeCharges(tx, existing.id, taxes)
    await writeTrailers(tx, existing.id, trailers)
    const dropped = (
      await tx
        .select({ id: tripDocuments.id, storedName: tripDocuments.storedName })
        .from(tripDocuments)
        .where(eq(tripDocuments.manifestId, existing.id))
    ).filter((d) => !documents.keep.includes(d.id))
    if (dropped.length > 0) {
      await tx.delete(tripDocuments).where(
        inArray(
          tripDocuments.id,
          dropped.map((d) => d.id)
        )
      )
    }
    await insertDocuments(tx, existing.id, documents.add)
    return dropped.map((d) => d.storedName)
  })
  if (removed) {
    removeStoredFiles(existing.id, removed)
    moveStaged(existing.id, documents.add)
  }
  const row = await findOwnedTripRow(scope, existing.id)
  if (!row) return failure('manifest_not_found')
  if (row.status !== 'draft') return failure('not_draft')
  return { ok: true, data: await toTripRecord(row) }
}

// Deletes a draft trip for good; once its bill is issued the trip is part of the record
export async function deleteTrip(
  scope: CompanyScope,
  manifestId: number
): Promise<FleetResult<null>> {
  const existing = await findOwnedTripRow(scope, manifestId)
  if (!existing) return failure('manifest_not_found')
  if (existing.status !== 'draft') return failure('not_draft')

  const deleted = await getDb().transaction(async (tx) => {
    // Re-checked inside the transaction so a bill issued meanwhile isn't lost
    if ((await lockedStatus(tx, existing.id)) !== 'draft') return false
    await tx.delete(manifestCargoItems).where(eq(manifestCargoItems.manifestId, existing.id))
    await tx.delete(manifestCharges).where(eq(manifestCharges.manifestId, existing.id))
    await tx.delete(manifestTrailers).where(eq(manifestTrailers.manifestId, existing.id))
    await tx.delete(tripDocuments).where(eq(tripDocuments.manifestId, existing.id))
    await tx.delete(manifests).where(eq(manifests.id, existing.id))
    return true
  })
  if (!deleted) return failure('not_draft')
  // The trip is gone either way; a folder left behind is removed on the next startup
  try {
    removeTripFolder(existing.id)
  } catch (err) {
    log.error('Removing trip documents failed:', err)
  }
  return { ok: true, data: null }
}

const MAX_SUGGESTED_PARTIES = 50

// Senders and receivers from the trips the member can see (newest first, each once), and the
// packing types they used, for the trip form's suggestions
export async function listSuggestions(scope: CompanyScope): Promise<TripSuggestions> {
  const db = getDb()
  const rows = await db
    .select({
      shipperName: manifests.shipperName,
      shipperAddress: manifests.shipperAddress,
      shipperPhone: manifests.shipperPhone,
      receiverName: manifests.receiverName,
      receiverAddress: manifests.receiverAddress,
      receiverPhone: manifests.receiverPhone
    })
    .from(manifests)
    .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
    .where(tripScopeCondition(scope))
    .orderBy(desc(manifests.createdAt), desc(manifests.id))
  const parties = new Map<string, Party>()
  for (const row of rows) {
    for (const found of [
      party(row.shipperName, row.shipperAddress, row.shipperPhone),
      party(row.receiverName, row.receiverAddress, row.receiverPhone)
    ]) {
      const key = `${found.name}\n${found.address}\n${found.phone}`
      if (found.name && !parties.has(key)) parties.set(key, found)
    }
    if (parties.size >= MAX_SUGGESTED_PARTIES) break
  }

  const packingTypes = (
    await db
      .selectDistinct({ packingType: manifestCargoItems.packingType })
      .from(manifestCargoItems)
      .innerJoin(manifests, eq(manifestCargoItems.manifestId, manifests.id))
      .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
      .where(and(tripScopeCondition(scope), isNotNull(manifestCargoItems.packingType)))
  ).flatMap((row) => (row.packingType ? [row.packingType] : []))
  return { parties: [...parties.values()].slice(0, MAX_SUGGESTED_PARTIES), packingTypes }
}
