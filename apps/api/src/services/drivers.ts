// A company's drivers. Trips pick one; the manifest keeps its own copy of the name and phone,
// so editing a driver later doesn't change manifests already issued.
import { and, asc, count, eq, ne } from 'drizzle-orm'
import { drivers, getDb, manifests, type Driver } from '../db'
import {
  MAX_DRIVER_NAME_LENGTH,
  type DriverInput,
  type DriverRecord,
  type FleetResult
} from '@masarat/shared/fleet'
import { normalizeSudanPhone } from '@masarat/shared/phone'

const toRecord = (driver: Driver, tripCount = 0): DriverRecord => ({
  id: driver.id,
  name: driver.name,
  phone: driver.phone,
  tripCount,
  createdAt: driver.createdAt.getTime()
})

// Input comes from the browser, so treat every field as untrusted
function validate(input: DriverInput): FleetResult<DriverInput> {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  const rawPhone = typeof input?.phone === 'string' ? input.phone.trim() : ''
  if (!name || !rawPhone || name.length > MAX_DRIVER_NAME_LENGTH) {
    return { ok: false, error: 'missing_fields' }
  }
  const phone = normalizeSudanPhone(rawPhone)
  if (!phone) return { ok: false, error: 'invalid_phone' }
  return { ok: true, data: { name, phone } }
}

// Phone numbers are unique within a company's drivers
async function phoneTaken(companyId: number, phone: string, exceptId?: number): Promise<boolean> {
  const condition = and(
    eq(drivers.companyId, companyId),
    eq(drivers.phone, phone),
    exceptId === undefined ? undefined : ne(drivers.id, exceptId)
  )
  const [taken] = await getDb().select({ id: drivers.id }).from(drivers).where(condition).limit(1)
  return Boolean(taken)
}

export async function findOwnedDriver(
  companyId: number,
  driverId: unknown
): Promise<Driver | undefined> {
  if (typeof driverId !== 'number') return undefined
  const [driver] = await getDb()
    .select()
    .from(drivers)
    .where(and(eq(drivers.id, driverId), eq(drivers.companyId, companyId)))
    .limit(1)
  return driver
}

export async function listDrivers(companyId: number): Promise<DriverRecord[]> {
  const rows = await getDb()
    .select({ driver: drivers, tripCount: count(manifests.id) })
    .from(drivers)
    .leftJoin(manifests, eq(manifests.driverId, drivers.id))
    .where(eq(drivers.companyId, companyId))
    .groupBy(drivers.id)
    .orderBy(asc(drivers.name), asc(drivers.id))
  return rows.map((row) => toRecord(row.driver, row.tripCount))
}

export async function addDriver(
  companyId: number,
  input: DriverInput
): Promise<FleetResult<DriverRecord>> {
  const checked = validate(input)
  if (!checked.ok) return checked
  if (await phoneTaken(companyId, checked.data.phone)) return { ok: false, error: 'phone_taken' }

  const [created] = await getDb()
    .insert(drivers)
    .values({ companyId, ...checked.data })
    .returning()
  return { ok: true, data: toRecord(created) }
}

export async function updateDriver(
  companyId: number,
  driverId: number,
  input: DriverInput
): Promise<FleetResult<DriverRecord>> {
  const existing = await findOwnedDriver(companyId, driverId)
  if (!existing) return { ok: false, error: 'driver_not_found' }
  const checked = validate(input)
  if (!checked.ok) return checked
  if (await phoneTaken(companyId, checked.data.phone, existing.id)) {
    return { ok: false, error: 'phone_taken' }
  }

  const [updated] = await getDb()
    .update(drivers)
    .set(checked.data)
    .where(eq(drivers.id, existing.id))
    .returning()
  return { ok: true, data: toRecord(updated) }
}

export async function deleteDriver(
  companyId: number,
  driverId: number
): Promise<FleetResult<null>> {
  const existing = await findOwnedDriver(companyId, driverId)
  if (!existing) return { ok: false, error: 'driver_not_found' }
  // A draft still needs its driver; billed manifests keep their own copy of the name and phone
  const [draft] = await getDb()
    .select({ id: manifests.id })
    .from(manifests)
    .where(and(eq(manifests.driverId, existing.id), eq(manifests.status, 'draft')))
    .limit(1)
  if (draft) return { ok: false, error: 'driver_in_use' }
  await getDb().delete(drivers).where(eq(drivers.id, existing.id))
  return { ok: true, data: null }
}
