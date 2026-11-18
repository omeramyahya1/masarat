// A fleet owner's drivers. Trips pick one; the manifest keeps its own copy of the name and phone,
// so editing a driver later doesn't change manifests already issued.
import { and, asc, eq, ne } from 'drizzle-orm'
import { drivers, getDb, type Driver } from '../db'
import {
  MAX_DRIVER_NAME_LENGTH,
  normalizePhone,
  type DriverInput,
  type DriverRecord,
  type FleetResult
} from '../../shared/fleet'

const toRecord = (driver: Driver): DriverRecord => ({
  id: driver.id,
  name: driver.name,
  phone: driver.phone,
  createdAt: driver.createdAt.getTime()
})

// IPC input comes from the renderer, so treat every field as untrusted
function validate(input: DriverInput): FleetResult<DriverInput> {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  const rawPhone = typeof input?.phone === 'string' ? input.phone.trim() : ''
  if (!name || !rawPhone || name.length > MAX_DRIVER_NAME_LENGTH) {
    return { ok: false, error: 'missing_fields' }
  }
  const phone = normalizePhone(rawPhone)
  if (!phone) return { ok: false, error: 'invalid_phone' }
  return { ok: true, data: { name, phone } }
}

// Phone numbers are unique within an owner's drivers
function phoneTaken(ownerId: number, phone: string, exceptId?: number): boolean {
  const condition = and(
    eq(drivers.ownerId, ownerId),
    eq(drivers.phone, phone),
    exceptId === undefined ? undefined : ne(drivers.id, exceptId)
  )
  return Boolean(getDb().select({ id: drivers.id }).from(drivers).where(condition).get())
}

export function findOwnedDriver(ownerId: number, driverId: unknown): Driver | undefined {
  if (typeof driverId !== 'number') return undefined
  return getDb()
    .select()
    .from(drivers)
    .where(and(eq(drivers.id, driverId), eq(drivers.ownerId, ownerId)))
    .get()
}

export function listDrivers(ownerId: number): DriverRecord[] {
  return getDb()
    .select()
    .from(drivers)
    .where(eq(drivers.ownerId, ownerId))
    .orderBy(asc(drivers.name), asc(drivers.id))
    .all()
    .map(toRecord)
}

export function addDriver(ownerId: number, input: DriverInput): FleetResult<DriverRecord> {
  const checked = validate(input)
  if (!checked.ok) return checked
  if (phoneTaken(ownerId, checked.data.phone)) return { ok: false, error: 'phone_taken' }

  const created = getDb()
    .insert(drivers)
    .values({ ownerId, ...checked.data })
    .returning()
    .get()
  return { ok: true, data: toRecord(created) }
}

export function updateDriver(
  ownerId: number,
  driverId: number,
  input: DriverInput
): FleetResult<DriverRecord> {
  const existing = findOwnedDriver(ownerId, driverId)
  if (!existing) return { ok: false, error: 'driver_not_found' }
  const checked = validate(input)
  if (!checked.ok) return checked
  if (phoneTaken(ownerId, checked.data.phone, existing.id)) {
    return { ok: false, error: 'phone_taken' }
  }

  const updated = getDb()
    .update(drivers)
    .set(checked.data)
    .where(eq(drivers.id, existing.id))
    .returning()
    .get()
  return { ok: true, data: toRecord(updated) }
}

export function deleteDriver(ownerId: number, driverId: number): FleetResult<null> {
  const existing = findOwnedDriver(ownerId, driverId)
  if (!existing) return { ok: false, error: 'driver_not_found' }
  getDb().delete(drivers).where(eq(drivers.id, existing.id)).run()
  return { ok: true, data: null }
}
