// Turns the shared analytics filters (src/shared/analytics.ts) into query conditions, for the
// dashboard, the report, the raw data export and the government search
import { and, eq, exists, inArray, or, type SQL, type SQLWrapper } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { cities, companies, getDb, manifestCargoItems, manifests, states, vehicles } from '../db'
import type { AnalyticsFilters } from '@masarat/shared/analytics'
import type { CompanyOption } from '@masarat/shared/analytics'

const originCity = alias(cities, 'filter_origin')
const destinationCity = alias(cities, 'filter_destination')

// A city's state, by the state's name
const inState = (stateId: SQLWrapper, name: string): SQL =>
  inArray(stateId, getDb().select({ id: states.id }).from(states).where(eq(states.name, name)))

// Conditions on the trip itself (route, cargo, vehicle, company); the date range is applied by each
// query to the date it is about. Undefined when no such filter is set.
export function tripConditions(f: AnalyticsFilters): SQL | undefined {
  const conditions: (SQL | undefined)[] = [
    f.originCityId ? eq(manifests.originCityId, f.originCityId) : undefined,
    f.destinationCityId ? eq(manifests.destinationCityId, f.destinationCityId) : undefined,
    f.originState ? inState(originCity.stateId, f.originState) : undefined,
    f.destinationState ? inState(destinationCity.stateId, f.destinationState) : undefined,
    f.tripKind ? eq(manifests.tripKind, f.tripKind) : undefined,
    f.vehicleType ? eq(vehicles.vehicleType, f.vehicleType) : undefined,
    f.companyId ? eq(vehicles.companyId, f.companyId) : undefined,
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

// Transport companies, for the company filter
export async function listCompanies(): Promise<CompanyOption[]> {
  const rows = await getDb().select({ id: companies.id, name: companies.name }).from(companies)
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}
