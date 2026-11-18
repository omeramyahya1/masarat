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
} from '../../shared/fleet'
import { normalizePlate } from '../../shared/plate'

// IPC input comes from the renderer, so treat every field as untrusted
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

function tripCountOf(vehicleId: number): number {
  const row = getDb()
    .select({ value: count() })
    .from(manifests)
    .where(eq(manifests.vehicleId, vehicleId))
    .get()
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

function plateTaken(plateNumber: string, exceptId?: number): boolean {
  const condition =
    exceptId === undefined
      ? eq(vehicles.plateNumber, plateNumber)
      : and(eq(vehicles.plateNumber, plateNumber), ne(vehicles.id, exceptId))
  return Boolean(getDb().select({ id: vehicles.id }).from(vehicles).where(condition).get())
}

function findOwned(ownerId: number, vehicleId: unknown): Vehicle | undefined {
  if (typeof vehicleId !== 'number') return undefined
  return getDb()
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.ownerId, ownerId)))
    .get()
}

export function listVehicles(ownerId: number): VehicleRecord[] {
  const rows = getDb()
    .select({ vehicle: vehicles, tripCount: count(manifests.id) })
    .from(vehicles)
    .leftJoin(manifests, eq(manifests.vehicleId, vehicles.id))
    .where(eq(vehicles.ownerId, ownerId))
    .groupBy(vehicles.id)
    .orderBy(vehicles.createdAt, vehicles.id)
    .all()
  return rows.map((row) => toRecord(row.vehicle, row.tripCount))
}

export function addVehicle(ownerId: number, input: VehicleInput): FleetResult<VehicleRecord> {
  const checked = validate(input)
  if (!checked.ok) return checked
  if (plateTaken(checked.data.plateNumber)) return { ok: false, error: 'plate_taken' }

  const created = getDb()
    .insert(vehicles)
    .values({ ownerId, ...checked.data })
    .returning()
    .get()
  return { ok: true, data: toRecord(created, 0) }
}

export function updateVehicle(
  ownerId: number,
  vehicleId: number,
  input: VehicleInput
): FleetResult<VehicleRecord> {
  const existing = findOwned(ownerId, vehicleId)
  if (!existing) return { ok: false, error: 'vehicle_not_found' }
  const checked = validate(input)
  if (!checked.ok) return checked
  if (plateTaken(checked.data.plateNumber, existing.id)) return { ok: false, error: 'plate_taken' }
  // Trips recorded their cargo in this vehicle's unit; changing it would contradict them
  const conflictingTrip = getDb()
    .select({ id: manifests.id })
    .from(manifests)
    .where(
      and(eq(manifests.vehicleId, existing.id), ne(manifests.cargoUnit, checked.data.capacityUnit))
    )
    .get()
  if (conflictingTrip) return { ok: false, error: 'unit_in_use' }

  const updated = getDb()
    .update(vehicles)
    .set(checked.data)
    .where(eq(vehicles.id, existing.id))
    .returning()
    .get()
  return { ok: true, data: toRecord(updated, tripCountOf(existing.id)) }
}

export function deleteVehicle(ownerId: number, vehicleId: number): FleetResult<null> {
  const existing = findOwned(ownerId, vehicleId)
  if (!existing) return { ok: false, error: 'vehicle_not_found' }
  // manifests.vehicle_id is ON DELETE RESTRICT; report it instead of surfacing a constraint error
  if (tripCountOf(existing.id) > 0) return { ok: false, error: 'vehicle_in_use' }

  getDb().delete(vehicles).where(eq(vehicles.id, existing.id)).run()
  return { ok: true, data: null }
}

export { findOwned as findOwnedVehicle }
