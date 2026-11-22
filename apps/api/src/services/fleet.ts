import { and, count, eq, ne } from 'drizzle-orm'
import { getDb, manifests, vehicles, type Vehicle } from '../db'
import {
  MAX_REGISTRATION_LENGTH,
  QUANTITY_UNITS,
  VEHICLE_TYPES,
  type FleetResult,
  type QuantityUnit,
  type VehicleInput,
  type VehicleRecord,
  type VehicleType
} from '@masarat/shared/fleet'
import { normalizePlate } from '@masarat/shared/plate'

// Input comes from the browser, so treat every field as untrusted
const isVehicleType = (value: unknown): value is VehicleType =>
  (VEHICLE_TYPES as readonly unknown[]).includes(value)
const isUnit = (value: unknown): value is QuantityUnit =>
  (QUANTITY_UNITS as readonly unknown[]).includes(value)

function toRecord(vehicle: Vehicle, tripCount: number): VehicleRecord {
  return {
    id: vehicle.id,
    plateNumber: vehicle.plateNumber,
    registrationNo: vehicle.registrationNo,
    vehicleType: vehicle.vehicleType,
    capacity: vehicle.capacity,
    capacityUnit: vehicle.capacityUnit,
    tripCount,
    createdAt: vehicle.createdAt.getTime()
  }
}

async function tripCountOf(vehicleId: number): Promise<number> {
  const [row] = await getDb()
    .select({ value: count() })
    .from(manifests)
    .where(eq(manifests.vehicleId, vehicleId))
  return row?.value ?? 0
}

// Plate format is a UI-level rule (not a DB constraint); it's re-checked here with the same parser
function validate(input: VehicleInput): FleetResult<VehicleInput> {
  if (!input || !isVehicleType(input.vehicleType) || !isUnit(input.capacityUnit)) {
    return { ok: false, error: 'missing_fields' }
  }
  const plateNumber =
    typeof input.plateNumber === 'string' ? normalizePlate(input.plateNumber) : null
  if (!plateNumber) return { ok: false, error: 'invalid_plate' }
  const registrationNo = typeof input.registrationNo === 'string' ? input.registrationNo.trim() : ''
  if (!registrationNo || registrationNo.length > MAX_REGISTRATION_LENGTH) {
    return { ok: false, error: 'invalid_registration' }
  }
  if (
    typeof input.capacity !== 'number' ||
    !Number.isFinite(input.capacity) ||
    input.capacity <= 0
  ) {
    return { ok: false, error: 'invalid_capacity' }
  }
  return {
    ok: true,
    data: {
      plateNumber,
      registrationNo,
      vehicleType: input.vehicleType,
      capacity: input.capacity,
      capacityUnit: input.capacityUnit
    }
  }
}

async function plateTaken(plateNumber: string, exceptId?: number): Promise<boolean> {
  const condition =
    exceptId === undefined
      ? eq(vehicles.plateNumber, plateNumber)
      : and(eq(vehicles.plateNumber, plateNumber), ne(vehicles.id, exceptId))
  const [taken] = await getDb().select({ id: vehicles.id }).from(vehicles).where(condition).limit(1)
  return Boolean(taken)
}

async function findOwned(companyId: number, vehicleId: unknown): Promise<Vehicle | undefined> {
  if (typeof vehicleId !== 'number') return undefined
  const [vehicle] = await getDb()
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.companyId, companyId)))
    .limit(1)
  return vehicle
}

export async function listVehicles(companyId: number): Promise<VehicleRecord[]> {
  const rows = await getDb()
    .select({ vehicle: vehicles, tripCount: count(manifests.id) })
    .from(vehicles)
    .leftJoin(manifests, eq(manifests.vehicleId, vehicles.id))
    .where(eq(vehicles.companyId, companyId))
    .groupBy(vehicles.id)
    .orderBy(vehicles.createdAt, vehicles.id)
  return rows.map((row) => toRecord(row.vehicle, row.tripCount))
}

export async function addVehicle(
  companyId: number,
  input: VehicleInput
): Promise<FleetResult<VehicleRecord>> {
  const checked = validate(input)
  if (!checked.ok) return checked
  if (await plateTaken(checked.data.plateNumber)) return { ok: false, error: 'plate_taken' }

  const [created] = await getDb()
    .insert(vehicles)
    .values({ companyId, ...checked.data })
    .returning()
  return { ok: true, data: toRecord(created, 0) }
}

export async function updateVehicle(
  companyId: number,
  vehicleId: number,
  input: VehicleInput
): Promise<FleetResult<VehicleRecord>> {
  const existing = await findOwned(companyId, vehicleId)
  if (!existing) return { ok: false, error: 'vehicle_not_found' }
  const checked = validate(input)
  if (!checked.ok) return checked
  if (await plateTaken(checked.data.plateNumber, existing.id)) {
    return { ok: false, error: 'plate_taken' }
  }
  // Trips recorded their cargo in this vehicle's unit; changing it would contradict them
  const [conflictingTrip] = await getDb()
    .select({ id: manifests.id })
    .from(manifests)
    .where(
      and(eq(manifests.vehicleId, existing.id), ne(manifests.cargoUnit, checked.data.capacityUnit))
    )
    .limit(1)
  if (conflictingTrip) return { ok: false, error: 'unit_in_use' }

  const [updated] = await getDb()
    .update(vehicles)
    .set(checked.data)
    .where(eq(vehicles.id, existing.id))
    .returning()
  return { ok: true, data: toRecord(updated, await tripCountOf(existing.id)) }
}

export async function deleteVehicle(
  companyId: number,
  vehicleId: number
): Promise<FleetResult<null>> {
  const existing = await findOwned(companyId, vehicleId)
  if (!existing) return { ok: false, error: 'vehicle_not_found' }
  // manifests.vehicle_id is ON DELETE RESTRICT; report it instead of surfacing a constraint error
  if ((await tripCountOf(existing.id)) > 0) return { ok: false, error: 'vehicle_in_use' }

  await getDb().delete(vehicles).where(eq(vehicles.id, existing.id))
  return { ok: true, data: null }
}

export { findOwned as findOwnedVehicle }
