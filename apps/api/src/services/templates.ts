// A company's passenger trip templates (packages/shared/src/templates.ts): a route, a bus and its
// usual driver, the time it leaves and how long it takes, and the branch it's sold at. Everyone
// with templates.use sees them (a branch member only their branch's); templates.manage keeps them.
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm'
import { branches, cities, getDb, tripTemplates, type TripTemplate } from '../db'
import type { FleetResult } from '@masarat/shared/fleet'
import {
  MAX_TEMPLATE_MINUTES,
  MAX_TEMPLATE_NAME_LENGTH,
  TIME_OF_DAY,
  type TemplateInput,
  type TemplateRecord
} from '@masarat/shared/templates'
import type { CompanyScope } from './access'
import { findOwnedDriver } from './drivers'
import { findOwnedVehicle } from './fleet'

const toRecord = (t: TripTemplate): TemplateRecord => ({
  id: t.id,
  name: t.name,
  branchId: t.branchId,
  originCityId: t.originCityId,
  destinationCityId: t.destinationCityId,
  vehicleId: t.vehicleId,
  driverId: t.driverId,
  departureTime: t.departureTime,
  durationMinutes: t.durationMinutes
})

const scoped = (scope: CompanyScope): SQL | undefined =>
  and(
    eq(tripTemplates.companyId, scope.companyId),
    scope.branchId === null ? undefined : eq(tripTemplates.branchId, scope.branchId)
  )

export async function listTemplates(scope: CompanyScope): Promise<TemplateRecord[]> {
  const rows = await getDb()
    .select()
    .from(tripTemplates)
    .where(scoped(scope))
    .orderBy(asc(tripTemplates.departureTime), asc(tripTemplates.name))
  return rows.map(toRecord)
}

// Input comes from the browser, so treat every field as untrusted
async function validate(
  scope: CompanyScope,
  input: TemplateInput
): Promise<FleetResult<Omit<typeof tripTemplates.$inferInsert, 'companyId'>>> {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > MAX_TEMPLATE_NAME_LENGTH) return { ok: false, error: 'missing_fields' }
  const durationMinutes = Number(input.durationMinutes)
  if (
    typeof input.departureTime !== 'string' ||
    !TIME_OF_DAY.test(input.departureTime) ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes <= 0 ||
    durationMinutes > MAX_TEMPLATE_MINUTES
  ) {
    return { ok: false, error: 'invalid_template' }
  }
  if (input.originCityId === input.destinationCityId) return { ok: false, error: 'same_route' }
  const route = await getDb()
    .select({ id: cities.id })
    .from(cities)
    .where(inArray(cities.id, [Number(input.originCityId), Number(input.destinationCityId)]))
  if (route.length !== 2) return { ok: false, error: 'city_not_found' }

  // A branch member keeps their own branch's templates
  const branchId = scope.branchId ?? Number(input.branchId)
  const [branch] = await getDb()
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.companyId, scope.companyId)))
    .limit(1)
  if (!branch) return { ok: false, error: 'branch_not_found' }

  const vehicle = await findOwnedVehicle(scope.companyId, input.vehicleId)
  if (!vehicle) return { ok: false, error: 'vehicle_not_found' }
  // Templates are for passenger trips
  if (vehicle.vehicleType !== 'bus') return { ok: false, error: 'invalid_template' }
  const driverId = input.driverId ?? null
  if (driverId !== null && !(await findOwnedDriver(scope.companyId, driverId))) {
    return { ok: false, error: 'driver_not_found' }
  }
  return {
    ok: true,
    data: {
      name,
      branchId,
      originCityId: Number(input.originCityId),
      destinationCityId: Number(input.destinationCityId),
      vehicleId: vehicle.id,
      driverId,
      departureTime: input.departureTime,
      durationMinutes
    }
  }
}

export async function createTemplate(
  scope: CompanyScope,
  input: TemplateInput
): Promise<FleetResult<TemplateRecord>> {
  const checked = await validate(scope, input)
  if (!checked.ok) return checked
  const [created] = await getDb()
    .insert(tripTemplates)
    .values({ ...checked.data, companyId: scope.companyId })
    .returning()
  return { ok: true, data: toRecord(created) }
}

export async function updateTemplate(
  scope: CompanyScope,
  templateId: number,
  input: TemplateInput
): Promise<FleetResult<TemplateRecord>> {
  const checked = await validate(scope, input)
  if (!checked.ok) return checked
  const [updated] = await getDb()
    .update(tripTemplates)
    .set(checked.data)
    .where(and(eq(tripTemplates.id, templateId), scoped(scope)))
    .returning()
  return updated
    ? { ok: true, data: toRecord(updated) }
    : { ok: false, error: 'template_not_found' }
}

export async function deleteTemplate(
  scope: CompanyScope,
  templateId: number
): Promise<FleetResult<null>> {
  const [deleted] = await getDb()
    .delete(tripTemplates)
    .where(and(eq(tripTemplates.id, templateId), scoped(scope)))
    .returning({ id: tripTemplates.id })
  return deleted ? { ok: true, data: null } : { ok: false, error: 'template_not_found' }
}
