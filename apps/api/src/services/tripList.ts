// The company's trips list (a branch member's: their branch's), one period at a time (a month by
// default, at most MAX_PERIOD_DAYS), paged within it: search, filters, sort, and grouping across
// the period's pages. Everything (the counts, the groups, the search) covers the period only, so
// a query reads one range of the company's (or branch's) index, never the whole history. Rows are
// ordered by their group first, so each page carries the headers of the groups on it, with each
// group's count and total due over the period.
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
import { alias, type PgSelect } from 'drizzle-orm/pg-core'
import {
  cities,
  getDb,
  manifestCargoItems,
  manifests,
  people,
  tripPassengers,
  vehicles
} from '../db'
import { idSearchKey } from '@masarat/shared/passengers'
import { TRIP_CATEGORIES } from '@masarat/shared/tax'
import {
  CARGO_TYPES,
  MANIFEST_STATUSES,
  MAX_PERIOD_DAYS,
  monthPeriod,
  TRIP_KINDS,
  type FleetResult,
  type TripGroup,
  type TripListQuery,
  type TripRecord
} from '@masarat/shared/fleet'
import type { GroupSummary, Page } from '@masarat/shared/paging'
import { plateSearchKey } from '@masarat/shared/plate'
import { tripScopeCondition, type CompanyScope } from './access'
import { escapeLike, plateKeyOf } from './sqlText'
import { toTripRecords, tripColumns } from './trips'

const origin = alias(cities, 'list_origin')
const destination = alias(cities, 'list_destination')

// "YYYY-MM-DD" as local midnight (Sudan time, see config.ts), or undefined
function day(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const [y, m, d] = match.slice(1).map(Number)
  const date = new Date(y, m - 1, d)
  return date.getMonth() === m - 1 && date.getDate() === d ? date : undefined
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

// What the search box matches, within the period: the trip number ("#12" or "12"), the plate
// (either script and digits, as part of it), or a whole name: a city, the driver, sender or
// receiver, a passenger, or a cargo item. Names are compared whole, by masarat_name_key (migration
// 0008: case, spaces and Arabic spelling variants don't matter), never as part of a name. A
// passenger is also found by their exact ID number.
function searchCondition(text: string): SQL | undefined {
  const plate = plateSearchKey(text)
  const idKey = idSearchKey(text)
  const tripNo = /^#?(\d{1,9})$/.exec(
    text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  )
  const key = sql`masarat_name_key(${text})`
  const sameName = (column: SQLWrapper): SQL => sql`masarat_name_key(${column}) = ${key}`
  return or(
    tripNo ? eq(manifests.id, Number(tripNo[1])) : undefined,
    plate.length >= 2
      ? sql`${plateKeyOf(vehicles.plateNumber)} LIKE ${`%${escapeLike(plate)}%`} ESCAPE '\\'`
      : undefined,
    sameName(origin.name),
    sameName(origin.nameAr),
    sameName(destination.name),
    sameName(destination.nameAr),
    sameName(manifests.driverName),
    sameName(manifests.shipperName),
    sameName(manifests.receiverName),
    // A passenger by their name as booked, or by their exact ID number (through the registry)
    exists(
      getDb()
        .select({ id: tripPassengers.id })
        .from(tripPassengers)
        .where(
          and(
            eq(tripPassengers.manifestId, manifests.id),
            or(
              sameName(tripPassengers.fullName),
              idKey
                ? inArray(
                    tripPassengers.personId,
                    getDb().select({ id: people.id }).from(people).where(eq(people.idNumber, idKey))
                  )
                : undefined
            )
          )
        )
    ),
    exists(
      getDb()
        .select({ id: manifestCargoItems.id })
        .from(manifestCargoItems)
        .where(
          and(eq(manifestCargoItems.manifestId, manifests.id), sameName(manifestCargoItems.name))
        )
    )
  )
}

// The period a query covers, as [from, to) local midnights and its days; the current month when
// it's missing; null when it isn't a valid range of at most MAX_PERIOD_DAYS days
export function resolvePeriod(
  q: Pick<TripListQuery, 'from' | 'to'>,
  now = new Date()
): { from: Date; to: Date; days: { from: string; to: string } } | null {
  const days =
    q.from === undefined && q.to === undefined
      ? monthPeriod(now.getFullYear(), now.getMonth())
      : { from: q.from ?? '', to: q.to ?? '' }
  const from = day(days.from)
  const last = day(days.to)
  if (!from || !last || last < from) return null
  const to = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)
  const span = Math.round((to.getTime() - from.getTime()) / 86_400_000)
  if (span > MAX_PERIOD_DAYS) return null
  return { from, to, days }
}

function filterConditions(
  scope: CompanyScope,
  q: TripListQuery,
  period: { from: Date; to: Date }
): SQL | undefined {
  return and(
    tripScopeCondition(scope),
    gte(manifests.departureAt, period.from),
    lt(manifests.departureAt, period.to),
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
    q.query ? searchCondition(q.query) : undefined
  )
}

export async function listTripsPage(
  scope: CompanyScope,
  q: TripListQuery
): Promise<FleetResult<Page<TripRecord>>> {
  const db = getDb()
  const period = resolvePeriod(q)
  if (!period) return { ok: false, error: 'invalid_period' }
  const inPeriod = and(
    tripScopeCondition(scope),
    gte(manifests.departureAt, period.from),
    lt(manifests.departureAt, period.to)
  )
  const where = filterConditions(scope, q, period)
  // Only a search reads the vehicle's plate and the cities' names; without one, the counts and
  // the group totals read manifests alone, through the company's (or branch's) index
  const searchJoins = <T extends PgSelect>(query: T): T =>
    q.query
      ? (query
          .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
          .innerJoin(origin, eq(manifests.originCityId, origin.id))
          .innerJoin(destination, eq(manifests.destinationCityId, destination.id)) as unknown as T)
      : query
  const [[{ total }], [{ overall }]] = await Promise.all([
    searchJoins(db.select({ total: count() }).from(manifests).$dynamic()).where(where),
    // Every trip of the period, before the search and filters
    db.select({ overall: count() }).from(manifests).where(inPeriod)
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
    // The keys are manifests' own columns (ids for vehicles, routes, branches), so the totals
    // need no join unless the search does
    const sumsQuery = db
      .select({
        key: sql<string>`${grouped.key}`,
        count: count(),
        totalDue: sql<number>`coalesce(sum(${manifests.taxAmount}), 0)`.mapWith(Number)
      })
      .from(manifests)
      .$dynamic()
    const sums =
      keys.length === 0
        ? []
        : await searchJoins(sumsQuery)
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
      groups,
      period: period.days
    }
  }
}
