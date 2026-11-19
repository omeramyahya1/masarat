// Turns the shared analytics filters (src/shared/analytics.ts) into query conditions, for the
// dashboard, the report, the raw data export and the government search
import { and, eq, exists, inArray, or, type SQL, type SQLWrapper } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { cities, getDb, manifestCargoItems, manifests, users, vehicles } from '../db'
import type { AnalyticsFilters } from '../../shared/analytics'
import type { OwnerOption } from '../../shared/analytics'

const originCity = alias(cities, 'filter_origin')
const destinationCity = alias(cities, 'filter_destination')

// Conditions on the trip itself (route, cargo, vehicle, owner); the date range is applied by each
// query to the date it is about. Undefined when no such filter is set.
export function tripConditions(f: AnalyticsFilters): SQL | undefined {
  const conditions: (SQL | undefined)[] = [
    f.originCityId ? eq(manifests.originCityId, f.originCityId) : undefined,
    f.destinationCityId ? eq(manifests.destinationCityId, f.destinationCityId) : undefined,
    f.originState ? eq(originCity.state, f.originState) : undefined,
    f.destinationState ? eq(destinationCity.state, f.destinationState) : undefined,
    f.tripKind ? eq(manifests.tripKind, f.tripKind) : undefined,
    f.vehicleType ? eq(vehicles.vehicleType, f.vehicleType) : undefined,
    f.ownerId ? eq(vehicles.ownerId, f.ownerId) : undefined,
    // Any item of that type (a trip can mix them), or the trip's own type for trips from before
    // cargo items existed
    f.cargoType
      ? or(
          eq(manifests.cargoType, f.cargoType),
          exists(
            getDb()
              .select({ id: manifestCargoItems.id })
              .from(manifestCargoItems)
              .where(
                and(
                  eq(manifestCargoItems.manifestId, manifests.id),
                  eq(manifestCargoItems.cargoType, f.cargoType)
                )
              )
          )
        )
      : undefined
  ].filter((c): c is SQL => c !== undefined)
  return conditions.length > 0 ? and(...conditions) : undefined
}

// "This manifest id is one of the filtered trips", for queries that start from payments,
// certificates, tax lines or cargo items. Undefined when no trip filter is set.
export function inFilteredTrips(column: SQLWrapper, f: AnalyticsFilters): SQL | undefined {
  const conditions = tripConditions(f)
  if (!conditions) return undefined
  return inArray(
    column,
    getDb()
      .select({ id: manifests.id })
      .from(manifests)
      .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
      .innerJoin(originCity, eq(manifests.originCityId, originCity.id))
      .innerJoin(destinationCity, eq(manifests.destinationCityId, destinationCity.id))
      .where(conditions)
  )
}

// Fleet owners, for the owner filter
export function listOwners(): OwnerOption[] {
  return getDb()
    .select({ id: users.id, companyName: users.companyName, fullName: users.fullName })
    .from(users)
    .where(eq(users.role, 'owner'))
    .all()
    .map((u) => ({ id: u.id, name: u.companyName || u.fullName }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
