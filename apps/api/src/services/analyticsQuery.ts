// Turns the shared analytics filters (src/shared/analytics.ts) into query conditions, for the
// dashboard, the report, the raw data export and the government search
import { and, eq, inArray, type SQL, type SQLWrapper } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { cities, companies, getDb, states, tripViews, vehicles } from '../db'
import type { AnalyticsFilters } from '@masarat/shared/analytics'
import type { CompanyOption } from '@masarat/shared/analytics'

// Reads live and archived trips alike (the all_* views)
const { manifests } = tripViews

// The trip's cities as the filters refer to them; a query using tripConditions joins these
export const originCity = alias(cities, 'filter_origin')
export const destinationCity = alias(cities, 'filter_destination')

// A city's state, by the state's name
const inState = (stateId: SQLWrapper, name: string): SQL =>
  inArray(stateId, getDb().select({ id: states.id }).from(states).where(eq(states.name, name)))

// Conditions on the trip itself (route, kind, trip type, vehicle, cargo); the date range is applied by each
// query to the date it is about. Undefined when no such filter is set.
export function tripConditions(f: AnalyticsFilters): SQL | undefined {
  const conditions: (SQL | undefined)[] = [
    f.originCityId ? eq(manifests.originCityId, f.originCityId) : undefined,
    f.destinationCityId ? eq(manifests.destinationCityId, f.destinationCityId) : undefined,
    f.originState ? inState(originCity.stateId, f.originState) : undefined,
    f.destinationState ? inState(destinationCity.stateId, f.destinationState) : undefined,
    f.category ? eq(manifests.category, f.category) : undefined,
    f.tripKind ? eq(manifests.tripKind, f.tripKind) : undefined,
    f.vehicleType ? eq(vehicles.vehicleType, f.vehicleType) : undefined,
    // The trip's main cargo type (its costliest item's), as the dashboard's nightly aggregates
    // count it, so the dashboard, the report and the exports agree
    f.cargoType ? eq(manifests.cargoType, f.cargoType) : undefined
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
