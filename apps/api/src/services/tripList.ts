// The company's trips list (a branch member's: their branch's), paged: search, filters, sort, and grouping across pages. Rows are ordered
// by their group first, so each page carries the headers of the groups on it, with each group's
// count and total due over every page.
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  inArray,
  lt,
  or,
  sql,
  type SQL,
  type SQLWrapper
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { cities, getDb, manifestCargoItems, manifests, tripPassengers, vehicles } from '../db'
import { idSearchKey } from '@masarat/shared/passengers'
import { TRIP_CATEGORIES } from '@masarat/shared/tax'
import {
  CARGO_TYPES,
  MANIFEST_STATUSES,
  TRIP_GROUPS,
  TRIP_KINDS,
  TRIP_SORTS,
  TRIP_STATUS_FILTERS,
  type FleetResult,
  type TripGroup,
  type TripListQuery,
  type TripRecord
} from '@masarat/shared/fleet'
import { DEFAULT_PAGE_SIZE, isPageSize, type GroupSummary, type Page } from '@masarat/shared/paging'
import { plateSearchKey } from '@masarat/shared/plate'
import { tripScopeCondition, type CompanyScope } from './access'
import { contains, escapeLike, plateKeyOf } from './sqlText'
import { toTripRecords, tripColumns } from './trips'

const origin = alias(cities, 'list_origin')
const destination = alias(cities, 'list_destination')

const MAX_QUERY_LENGTH = 80

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | undefined =>
  (list as readonly unknown[]).includes(value) ? (value as T) : undefined
const positiveInt = (value: unknown): number | undefined => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

// "YYYY-MM-DD" as local midnight (Sudan time, see config.ts), or undefined
function day(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const [y, m, d] = match.slice(1).map(Number)
  const date = new Date(y, m - 1, d)
  return date.getMonth() === m - 1 && date.getDate() === d ? date : undefined
}

// Query string values from the portal, checked; anything unknown is dropped
export function parseTripListQuery(raw: Record<string, string | undefined>): TripListQuery {
  const pageSize = Number(raw.pageSize)
  return {
    page: positiveInt(raw.page) ?? 1,
    pageSize: isPageSize(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    query: raw.query?.trim().slice(0, MAX_QUERY_LENGTH) || undefined,
    status: oneOf(TRIP_STATUS_FILTERS, raw.status),
    category: oneOf(TRIP_CATEGORIES, raw.category),
    tripKind: oneOf(TRIP_KINDS, raw.tripKind),
    cargoType: oneOf(CARGO_TYPES, raw.cargoType),
    vehicleId: positiveInt(raw.vehicleId),
    driverId: positiveInt(raw.driverId),
    branchId: positiveInt(raw.branchId),
    from: day(raw.from) ? raw.from : undefined,
    to: day(raw.to) ? raw.to : undefined,
    sort: oneOf(TRIP_SORTS, raw.sort) ?? 'departureAt',
    direction: raw.direction === 'asc' ? 'asc' : 'desc',
    group: oneOf(TRIP_GROUPS, raw.group),
    lang: raw.lang === 'ar' ? 'ar' : 'en'
  }
}

// Position in a fixed list, for ordering statuses, trip kinds and cargo types as the app lists them
const positionIn = (values: readonly string[], column: SQLWrapper): SQL =>
  sql`array_position(${sql.raw(`ARRAY[${values.map((v) => `'${v}'`).join(', ')}]::text[]`)}, ${column}::text)`

// Each group's key, and how the groups are ordered
function grouping(group: TripGroup, lang: 'en' | 'ar'): { key: SQL; order: SQL[] } {
  const cityName = (city: typeof origin | typeof destination): SQL =>
    lang === 'ar' ? sql`${city.nameAr}` : sql`${city.name}`
  switch (group) {
    case 'status':
      return {
        key: sql`${manifests.status}`,
        order: [asc(positionIn(MANIFEST_STATUSES, manifests.status))]
      }
    case 'month': {
      // Newest month first
      const month = sql`to_char(${manifests.departureAt}, 'YYYY-MM')`
      return { key: month, order: [desc(month)] }
    }
    case 'vehicle':
      return {
        key: sql`${manifests.vehicleId}::text`,
        order: [asc(vehicles.plateNumber), asc(manifests.vehicleId)]
      }
    case 'driver':
      return {
        key: sql`coalesce(${manifests.driverId}::text, '')`,
        order: [
          sql`${manifests.driverName} asc nulls last`,
          asc(sql`coalesce(${manifests.driverId}, 0)`)
        ]
      }
    case 'route':
      return {
        key: sql`${manifests.originCityId}::text || '-' || ${manifests.destinationCityId}::text`,
        order: [
          asc(cityName(origin)),
          asc(cityName(destination)),
          asc(manifests.originCityId),
          asc(manifests.destinationCityId)
        ]
      }
    case 'tripKind':
      return {
        key: sql`${manifests.tripKind}`,
        order: [asc(positionIn(TRIP_KINDS, manifests.tripKind))]
      }
    case 'cargoType':
      return {
        key: sql`${manifests.cargoType}`,
        order: [asc(positionIn(CARGO_TYPES, manifests.cargoType))]
      }
    case 'branch':
      return {
        key: sql`${manifests.branchId}::text`,
        order: [asc(tripColumns.branchName), asc(manifests.branchId)]
      }
    case 'category':
      return {
        key: sql`${manifests.category}`,
        order: [asc(positionIn(TRIP_CATEGORIES, manifests.category))]
      }
  }
}

const SORT_COLUMNS: Record<TripListQuery['sort'], SQLWrapper> = {
  departureAt: manifests.departureAt,
  createdAt: manifests.createdAt,
  amount: sql`${manifests.taxAmount}`,
  tripCost: sql`${manifests.tripCost}`,
  distance: sql`${manifests.distanceKm}`,
  status: positionIn(MANIFEST_STATUSES, manifests.status)
}

// What the search box matches: the trip number ("#12"), the plate (either script and digits),
// a city, the driver, sender or receiver, or a cargo item's name
function searchCondition(text: string): SQL | undefined {
  const plate = plateSearchKey(text)
  const idKey = idSearchKey(text)
  return or(
    contains(sql`'#' || ${manifests.id}::text`, text),
    plate.length >= 2
      ? sql`${plateKeyOf(vehicles.plateNumber)} LIKE ${`%${escapeLike(plate)}%`} ESCAPE '\\'`
      : undefined,
    contains(origin.name, text),
    contains(origin.nameAr, text),
    contains(destination.name, text),
    contains(destination.nameAr, text),
    contains(manifests.driverName, text),
    contains(manifests.shipperName, text),
    contains(manifests.receiverName, text),
    // A passenger by name, or by their exact ID number
    exists(
      getDb()
        .select({ id: tripPassengers.id })
        .from(tripPassengers)
        .where(
          and(
            eq(tripPassengers.manifestId, manifests.id),
            or(
              contains(tripPassengers.fullName, text),
              idKey ? eq(tripPassengers.idNumber, idKey) : undefined
            )
          )
        )
    ),
    exists(
      getDb()
        .select({ id: manifestCargoItems.id })
        .from(manifestCargoItems)
        .where(
          and(
            eq(manifestCargoItems.manifestId, manifests.id),
            contains(manifestCargoItems.name, text)
          )
        )
    )
  )
}

function filterConditions(scope: CompanyScope, q: TripListQuery): SQL | undefined {
  const from = q.from ? day(q.from) : undefined
  const to = q.to ? day(q.to) : undefined
  const nextDay = to ? new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1) : undefined
  return and(
    tripScopeCondition(scope),
    q.status === 'billed'
      ? inArray(manifests.status, ['billed', 'paid'])
      : q.status
        ? eq(manifests.status, q.status)
        : undefined,
    q.category ? eq(manifests.category, q.category) : undefined,
    q.tripKind ? eq(manifests.tripKind, q.tripKind) : undefined,
    // Any item of that type, or the trip's own type for trips from before cargo items existed
    q.cargoType
      ? or(
          eq(manifests.cargoType, q.cargoType),
          exists(
            getDb()
              .select({ id: manifestCargoItems.id })
              .from(manifestCargoItems)
              .where(
                and(
                  eq(manifestCargoItems.manifestId, manifests.id),
                  eq(manifestCargoItems.cargoType, q.cargoType)
                )
              )
          )
        )
      : undefined,
    q.vehicleId ? eq(manifests.vehicleId, q.vehicleId) : undefined,
    q.driverId ? eq(manifests.driverId, q.driverId) : undefined,
    q.branchId ? eq(manifests.branchId, q.branchId) : undefined,
    from ? gte(manifests.departureAt, from) : undefined,
    nextDay ? lt(manifests.departureAt, nextDay) : undefined,
    q.query ? searchCondition(q.query) : undefined
  )
}

export async function listTripsPage(
  scope: CompanyScope,
  q: TripListQuery
): Promise<FleetResult<Page<TripRecord>>> {
  const db = getDb()
  const where = filterConditions(scope, q)
  const [[{ total }], [{ overall }]] = await Promise.all([
    db
      .select({ total: count() })
      .from(manifests)
      .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
      .innerJoin(origin, eq(manifests.originCityId, origin.id))
      .innerJoin(destination, eq(manifests.destinationCityId, destination.id))
      .where(where),
    db
      .select({ overall: count() })
      .from(manifests)
      .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
      .where(tripScopeCondition(scope))
  ])

  // A page past the end shows the last one
  const pages = Math.max(1, Math.ceil(total / q.pageSize))
  const page = Math.min(q.page, pages)
  const grouped = q.group ? grouping(q.group, q.lang ?? 'en') : null
  const sortColumn = SORT_COLUMNS[q.sort]
  const by = q.direction === 'asc' ? asc : desc

  const rows = await db
    .select({ trip: tripColumns, groupKey: grouped ? grouped.key : sql<string>`''` })
    .from(manifests)
    .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
    .innerJoin(origin, eq(manifests.originCityId, origin.id))
    .innerJoin(destination, eq(manifests.destinationCityId, destination.id))
    .where(where)
    .orderBy(...(grouped?.order ?? []), by(sortColumn), by(manifests.id))
    .limit(q.pageSize)
    .offset((page - 1) * q.pageSize)

  let groups: GroupSummary[] | undefined
  if (grouped) {
    const keys = [...new Set(rows.map((r) => String(r.groupKey)))]
    const sums =
      keys.length === 0
        ? []
        : await db
            .select({
              key: sql<string>`${grouped.key}`,
              count: count(),
              totalDue: sql<number>`coalesce(sum(${manifests.taxAmount}), 0)`.mapWith(Number)
            })
            .from(manifests)
            .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
            .innerJoin(origin, eq(manifests.originCityId, origin.id))
            .innerJoin(destination, eq(manifests.destinationCityId, destination.id))
            .where(and(where, inArray(grouped.key, keys)))
            .groupBy(grouped.key)
    const byKey = new Map(sums.map((s) => [String(s.key), s]))
    groups = keys.map((key) => ({
      key,
      count: byKey.get(key)?.count ?? 0,
      totalDue: byKey.get(key)?.totalDue ?? 0
    }))
  }

  const records = await toTripRecords(rows.map((row) => row.trip))
  return {
    ok: true,
    data: {
      rows: grouped
        ? records.map((record, i) => ({ ...record, groupKey: String(rows[i].groupKey) }))
        : records,
      total,
      overall,
      page,
      pageSize: q.pageSize,
      groups
    }
  }
}
