// Government dashboard: totals and breakdowns across all transport companies, for the filters
// chosen. Revenue figures (the total, the previous period, the chart, by cargo type, by tax and
// fee, the breakdown) come from the daily summary (services/dailyRevenue.ts) when no trip filter
// is set, and from grouped SQL over the paid trips otherwise; Postgres does the adding up either
// way. The other figures are indexed counts.
import { and, count, desc, eq, gte, lt, ne, sql, sum, type SQL } from 'drizzle-orm'
import { type PgSelect } from 'drizzle-orm/pg-core'
import {
  archive,
  certificates as liveCertificates,
  companies,
  dailyRevenue,
  getDb,
  manifestCargoItems,
  manifestCharges as liveManifestCharges,
  manifests as liveManifests,
  manifestTrailers,
  payments as livePayments,
  states,
  tripDocuments,
  tripPassengers,
  tripViews,
  vehicles,
  type RevenueDimension
} from '../db'
import { MANIFEST_STATUSES, type ManifestStatus } from '@masarat/shared/fleet'
import {
  bucketStart,
  nextBucket,
  parseDay,
  resolveBucket,
  resolveRange,
  type AnalyticsFilters,
  type Breakdown,
  type BucketSize,
  type DashboardView
} from '@masarat/shared/analytics'
import {
  type BreakdownRow,
  type CargoSlice,
  type DashboardData,
  type DashboardNow,
  type RevenuePoint,
  type TaxSlice
} from '@masarat/shared/dashboard'
import { destinationCity, inFilteredTrips, originCity, tripConditions } from './analyticsQuery'
import { cargoSharesSql, dayOf, isSummaryStale } from './dailyRevenue'

// Reads live and archived trips alike (the all_* views)
const { certificates, manifestCharges, manifests, payments } = tripViews

// The live tables, as a set like tripViews and archive
const liveTables: typeof archive = {
  manifests: liveManifests,
  manifestCargoItems,
  manifestTrailers,
  tripPassengers,
  tripDocuments,
  manifestCharges: liveManifestCharges,
  payments: livePayments,
  certificates: liveCertificates
}

const RECENT_BILLS = 10

// A latest bill, as the dashboard lists it
interface BillRow {
  id: number
  manifestId: number
  billId: string
  createdAt: Date
  paidAt: Date | null
  status: (typeof payments.$inferSelect)['status']
  amount: number
  companyName: string
  plateNumber: string
  originCityId: number
  destinationCityId: number
}

const total = (value: string | number | null): number => Number(value ?? 0)
const revenueSum = sql<number>`sum(${payments.amount})`.mapWith(Number)

// The revenue figures, however they're computed
interface RevenueFigures {
  revenue: (from: Date, to: Date) => Promise<number>
  series: (from: Date, to: Date, bucket: BucketSize) => Promise<Map<number, RevenuePoint>>
  byCargo: (from: Date, to: Date) => Promise<CargoSlice[]>
  byTax: (from: Date, to: Date) => Promise<TaxSlice[]>
  breakdown: (from: Date, to: Date, by: Breakdown) => Promise<BreakdownRow[]>
}

// Revenue figures from grouped SQL over the paid trips matching the filters
function liveFigures(f: AnalyticsFilters): RevenueFigures {
  const db = getDb()
  // Paid payments with their trip, vehicle and cities, paid in [from, to) and matching the
  // filters. Every figure starts from here, so the filters apply by the trip's primary key.
  // `more` adds joins that refer to those tables (a city's state).
  const paid = <T extends PgSelect>(query: T, from: Date, to: Date, more?: (q: T) => T): T => {
    const joined = query
      .innerJoin(manifests, eq(payments.manifestId, manifests.id))
      .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
      .innerJoin(originCity, eq(manifests.originCityId, originCity.id))
      .innerJoin(
        destinationCity,
        eq(manifests.destinationCityId, destinationCity.id)
      ) as unknown as T
    return (more ? more(joined) : joined).where(
      and(
        eq(payments.status, 'paid'),
        gte(payments.paidAt, from),
        lt(payments.paidAt, to),
        tripConditions(f)
      )
    ) as unknown as T
  }

  return {
    async revenue(from, to) {
      const [row] = await paid(
        db
          .select({ value: sum(payments.amount) })
          .from(payments)
          .$dynamic(),
        from,
        to
      )
      return total(row?.value ?? null)
    },

    async series(from, to, bucket) {
      // Bucket starts in Sudan time (the session's zone); weeks start on Sunday
      const start =
        bucket === 'week'
          ? sql`date_trunc('week', ${payments.paidAt} + interval '1 day') - interval '1 day'`
          : // day or month, from the list (never user text): written into the SQL so the GROUP BY
            // matches the SELECT
            sql`date_trunc(${sql.raw(`'${bucket === 'month' ? 'month' : 'day'}'`)}, ${payments.paidAt})`
      const rows = await paid(
        db
          .select({
            start: sql<Date>`${start}`.mapWith((v: string | Date) => new Date(v)),
            revenue: revenueSum,
            trips: count()
          })
          .from(payments)
          .$dynamic(),
        from,
        to
      ).groupBy(start)
      return new Map(
        rows.map((r) => [
          r.start.getTime(),
          { start: r.start.getTime(), revenue: r.revenue, trips: r.trips }
        ])
      )
    },

    async byCargo(from, to) {
      const paidTrips = paid(
        db
          .select({
            manifest_id: payments.manifestId,
            amount: payments.amount,
            day: sql`${payments.paidAt}::date`.as('day'),
            cargo_type: manifests.cargoType
          })
          .from(payments)
          .$dynamic(),
        from,
        to
      )
      const rows = await db.execute<{ key: string; revenue: number; trips: number }>(sql`
        WITH paid AS (${paidTrips}), ${cargoSharesSql}
        SELECT key, sum(revenue)::float8 AS revenue, count(DISTINCT manifest_id)::int AS trips
        FROM cargo_shares GROUP BY key`)
      return cargoSlices(rows)
    },

    async byTax(from, to) {
      const taxRevenue = sql<number>`sum(${manifestCharges.amount})`.mapWith(Number)
      // A charge renamed since is shown under its latest name on a bill
      return paid(
        db
          .select({
            code: manifestCharges.code,
            name: sql<string>`(array_agg(${manifestCharges.name} order by ${manifestCharges.id} desc))[1]`,
            nameAr: sql<string>`(array_agg(${manifestCharges.nameAr} order by ${manifestCharges.id} desc))[1]`,
            revenue: taxRevenue
          })
          .from(payments)
          .innerJoin(manifestCharges, eq(manifestCharges.manifestId, payments.manifestId))
          .$dynamic(),
        from,
        to
      )
        .groupBy(manifestCharges.code)
        .orderBy(desc(taxRevenue))
    },

    async breakdown(from, to, by) {
      const grouped = async (
        key: SQL,
        join?: 'originState' | 'destinationState'
      ): Promise<BreakdownRow[]> => {
        const query = db
          .select({ key: sql<string>`${key}`, revenue: revenueSum, trips: count() })
          .from(payments)
          .$dynamic()
        const city = join === 'originState' ? originCity : destinationCity
        return paid(query, from, to, (q) =>
          join ? q.innerJoin(states, eq(city.stateId, states.id)) : q
        )
          .groupBy(key)
          .orderBy(desc(revenueSum))
      }
      switch (by) {
        case 'route':
          return withRouteCities(
            await grouped(
              sql`${manifests.originCityId}::text || '-' || ${manifests.destinationCityId}::text`
            )
          )
        case 'originState':
          return grouped(sql`${states.name}`, 'originState')
        case 'destinationState':
          return grouped(sql`${states.name}`, 'destinationState')
        case 'cargoType':
          return (await this.byCargo(from, to)).map((c) => ({
            key: c.cargoType,
            revenue: c.revenue,
            trips: c.trips
          }))
        case 'vehicleType':
          return grouped(sql`${vehicles.vehicleType}`)
        case 'tripKind':
          return grouped(sql`${manifests.tripKind}`)
        case 'category':
          return grouped(sql`${manifests.category}`)
        case 'company':
          return withCompanyNames(await grouped(sql`${manifests.companyId}::text`))
      }
    }
  }
}

// Revenue figures from the daily summary, which holds whole Sudan days. A range is split into the
// whole days it covers, read from the summary, and the partial days at either end, computed from
// the payments with the exact bounds: a preset runs up to now (today so far, and nothing paid
// after now), and the previous period of a preset starts mid-day.
function summaryFigures(): RevenueFigures {
  const db = getDb()
  const live = liveFigures({ range: { preset: '30d' } })
  const midnightOf = (date: Date): Date => parseDay(dayOf(date))!
  const nextMidnight = (date: Date): Date => {
    const next = midnightOf(date)
    next.setDate(next.getDate() + 1)
    return next
  }
  // [from, to) as whole days for the summary, and the partial pieces at the ends
  const split = (
    from: Date,
    to: Date
  ): { whole: { first: string; last: string } | null; partial: [Date, Date][] } => {
    const wholeFrom = midnightOf(from).getTime() === from.getTime() ? from : nextMidnight(from)
    const wholeTo = midnightOf(to)
    if (wholeFrom >= wholeTo) return { whole: null, partial: from < to ? [[from, to]] : [] }
    const partial: [Date, Date][] = []
    if (from < wholeFrom) partial.push([from, wholeFrom])
    if (wholeTo < to) partial.push([wholeTo, to])
    return {
      whole: { first: dayOf(wholeFrom), last: dayOf(new Date(wholeTo.getTime() - 1)) },
      partial
    }
  }
  const inDays = (whole: { first: string; last: string }): SQL | undefined =>
    and(gte(dailyRevenue.day, whole.first), sql`${dailyRevenue.day} <= ${whole.last}`)
  const dimension = (name: RevenueDimension): SQL => eq(dailyRevenue.dimension, name)
  type SummaryRow = {
    key: string
    revenue: number
    trips: number
    name: string | null
    nameAr: string | null
  }
  const grouped = async (
    name: RevenueDimension,
    whole: { first: string; last: string } | null
  ): Promise<SummaryRow[]> =>
    whole
      ? db
          .select({
            key: dailyRevenue.key,
            revenue: sql<number>`sum(${dailyRevenue.revenue})`.mapWith(Number),
            trips: sql<number>`sum(${dailyRevenue.trips})`.mapWith(Number),
            name: sql<
              string | null
            >`(array_agg(${dailyRevenue.name} order by ${dailyRevenue.day} desc))[1]`,
            nameAr: sql<
              string | null
            >`(array_agg(${dailyRevenue.nameAr} order by ${dailyRevenue.day} desc))[1]`
          })
          .from(dailyRevenue)
          .where(and(dimension(name), inDays(whole)))
          .groupBy(dailyRevenue.key)
      : []
  // Rows of the same key added together (whole days and partial ones), by revenue; the later
  // piece's name wins (a charge's name on its latest bill)
  const merge = <T extends { key: string; revenue: number; trips: number }>(lists: T[][]): T[] => {
    const byKey = new Map<string, T>()
    for (const row of lists.flat()) {
      const found = byKey.get(row.key)
      byKey.set(
        row.key,
        found
          ? {
              ...found,
              ...row,
              revenue: found.revenue + row.revenue,
              trips: found.trips + row.trips
            }
          : { ...row }
      )
    }
    return [...byKey.values()].sort((a, b) => b.revenue - a.revenue)
  }

  return {
    async revenue(from, to) {
      const { whole, partial } = split(from, to)
      let value = 0
      if (whole) {
        const [row] = await db
          .select({ value: sql<number>`coalesce(sum(${dailyRevenue.revenue}), 0)`.mapWith(Number) })
          .from(dailyRevenue)
          .where(and(dimension('total'), inDays(whole)))
        value += row?.value ?? 0
      }
      for (const [a, b] of partial) value += await live.revenue(a, b)
      return Math.round(value)
    },

    async series(from, to, bucket) {
      const { whole, partial } = split(from, to)
      const points = new Map<number, RevenuePoint>()
      const add = (start: number, revenue: number, trips: number): void => {
        const point = points.get(start) ?? { start, revenue: 0, trips: 0 }
        point.revenue += revenue
        point.trips += trips
        points.set(start, point)
      }
      if (whole) {
        for (const row of await db
          .select({
            day: dailyRevenue.day,
            revenue: dailyRevenue.revenue,
            trips: dailyRevenue.trips
          })
          .from(dailyRevenue)
          .where(and(dimension('total'), inDays(whole)))) {
          add(bucketStart(parseDay(row.day)!, bucket).getTime(), row.revenue, row.trips)
        }
      }
      for (const [a, b] of partial) {
        for (const point of (await live.series(a, b, bucket)).values()) {
          add(point.start, point.revenue, point.trips)
        }
      }
      for (const point of points.values()) point.revenue = Math.round(point.revenue)
      return points
    },

    async byCargo(from, to) {
      const { whole, partial } = split(from, to)
      const pieces = [
        (await grouped('cargo', whole)) as { key: string; revenue: number; trips: number }[]
      ]
      for (const [a, b] of partial) {
        pieces.push(
          (await live.byCargo(a, b)).map((c) => ({
            key: c.cargoType,
            revenue: c.revenue,
            trips: c.trips
          }))
        )
      }
      return cargoSlices(merge(pieces))
    },

    async byTax(from, to) {
      const { whole, partial } = split(from, to)
      const pieces = [
        (await grouped('charge', whole)).map((r) => ({
          key: r.key,
          name: r.name ?? r.key,
          nameAr: r.nameAr ?? r.name ?? r.key,
          revenue: r.revenue,
          trips: 0
        }))
      ]
      for (const [a, b] of partial) {
        pieces.push(
          (await live.byTax(a, b)).map((t) => ({
            key: t.code,
            name: t.name,
            nameAr: t.nameAr,
            revenue: t.revenue,
            trips: 0
          }))
        )
      }
      return merge(pieces).map((r) => ({
        code: r.key,
        name: r.name,
        nameAr: r.nameAr,
        revenue: Math.round(r.revenue)
      }))
    },

    async breakdown(from, to, by) {
      const { whole, partial } = split(from, to)
      const dimensionOf: Record<Breakdown, RevenueDimension> = {
        route: 'route',
        originState: 'origin_state',
        destinationState: 'destination_state',
        cargoType: 'cargo',
        vehicleType: 'vehicle_type',
        tripKind: 'trip_kind',
        category: 'category',
        company: 'company'
      }
      const pieces: BreakdownRow[][] = [
        (await grouped(dimensionOf[by], whole)).map((r) => ({
          key: r.key,
          revenue: r.revenue,
          trips: r.trips
        }))
      ]
      for (const [a, b] of partial) {
        pieces.push(
          (await live.breakdown(a, b, by)).map((r) => ({
            key: r.key,
            revenue: r.revenue,
            trips: r.trips
          }))
        )
      }
      const rows = merge(pieces).map((r) => ({ ...r, revenue: Math.round(r.revenue) }))
      if (by === 'route') return withRouteCities(rows)
      if (by === 'company') return withCompanyNames(rows)
      return rows
    }
  }
}

// Cargo slices by revenue, rounded at the end
function cargoSlices(rows: { key: string; revenue: number; trips: number }[]): CargoSlice[] {
  return rows
    .map((r) => ({
      cargoType: r.key as CargoSlice['cargoType'],
      revenue: Math.round(Number(r.revenue)),
      trips: Number(r.trips)
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

// A route's key is "<origin id>-<destination id>"; the card shows the cities
function withRouteCities(rows: BreakdownRow[]): BreakdownRow[] {
  return rows.map((r) => {
    const [origin, destination] = r.key.split('-').map(Number)
    return { ...r, originCityId: origin, destinationCityId: destination }
  })
}

// A company's key is its id; the card shows its name as it is now
async function withCompanyNames(rows: BreakdownRow[]): Promise<BreakdownRow[]> {
  const names = new Map(
    (await getDb().select({ id: companies.id, name: companies.name }).from(companies)).map((c) => [
      String(c.id),
      c.name
    ])
  )
  return rows.map((r) => ({ ...r, name: names.get(r.key) ?? r.key }))
}

export async function getDashboard(
  filters: AnalyticsFilters,
  view: DashboardView,
  // Tests compare the two; the API picks the summary whenever no trip filter is set
  source: 'auto' | 'live' = 'auto'
): Promise<DashboardData> {
  const db = getDb()
  const now = new Date()
  const { from, to } = resolveRange(filters.range, now)
  const previousFrom = new Date(from.getTime() - (to.getTime() - from.getTime()))
  const bucket = resolveBucket(from, to, view.bucket)
  // The summary answers unfiltered views, unless bulk writes have left it stale (dailyRevenue.ts)
  const figures =
    source === 'auto' && !tripConditions(filters) && !(await isSummaryStale())
      ? summaryFigures()
      : liveFigures(filters)
  // Trips matching the route / cargo / vehicle / company filters, for the latest bills
  const inTrips = (column: Parameters<typeof inFilteredTrips>[0]): SQL | undefined =>
    inFilteredTrips(column, filters)
  // The counts below read their indexes alone when no trip filter is set; with one, each row is
  // joined to its trip by the trip's primary key and the filter applied there (an IN over every
  // matching trip would read them all). `manifestId` is the column to join on, or null when the
  // query already has the trip.
  const tripFilter = tripConditions(filters)
  const withTrips = <T extends PgSelect>(
    query: T,
    manifestId: typeof payments.manifestId | typeof certificates.manifestId | null,
    where: SQL | undefined
  ): T => {
    if (!tripFilter) return query.where(where) as unknown as T
    let joined = query as unknown as PgSelect
    if (manifestId) joined = joined.innerJoin(manifests, eq(manifestId, manifests.id)) as never
    joined = joined
      .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
      .innerJoin(originCity, eq(manifests.originCityId, originCity.id))
      .innerJoin(destinationCity, eq(manifests.destinationCityId, destinationCity.id)) as never
    return joined.where(and(where, tripFilter)) as unknown as T
  }

  // Every figure below is its own query; they run together, so the dashboard takes about as long
  // as its slowest one (the pool and Postgres's cores serve them in parallel)
  const countOf = (rows: { value: number }[]): number => rows[0]?.value ?? 0

  const pendingQuery = withTrips(
    db
      .select({ bills: count(), amount: sum(payments.amount) })
      .from(payments)
      .$dynamic(),
    payments.manifestId,
    eq(payments.status, 'pending')
  )

  const billedQuery = withTrips(
    db
      .select({
        amount: sum(payments.amount),
        paid: sql<number>`coalesce(sum(case when ${payments.status} = 'paid' then ${payments.amount} else 0 end), 0)`.mapWith(
          Number
        )
      })
      .from(payments)
      .$dynamic(),
    payments.manifestId,
    and(gte(payments.createdAt, from), lt(payments.createdAt, to))
  )

  // The previous period's revenue, when the records reach back that far
  const previousRevenueQuery = db
    .select({ value: sql<Date | null>`min(${payments.paidAt})`.mapWith(payments.paidAt) })
    .from(payments)
    .where(eq(payments.status, 'paid'))
    .then(([first]) => {
      const firstPaidAt = first?.value ?? null
      return firstPaidAt && firstPaidAt <= previousFrom ? figures.revenue(previousFrom, from) : null
    })

  const statusQuery = withTrips(
    db.select({ status: manifests.status, value: count() }).from(manifests).$dynamic(),
    null,
    and(gte(manifests.createdAt, from), lt(manifests.createdAt, to))
  ).groupBy(manifests.status)

  // The latest bills, by when they were paid (or issued, if not paid yet): the newest paid ones
  // and the newest unpaid ones, each through its own index, then the newest of both
  const billColumns = {
    id: payments.id,
    manifestId: payments.manifestId,
    billId: payments.billId,
    createdAt: payments.createdAt,
    paidAt: payments.paidAt,
    status: payments.status,
    amount: payments.amount,
    companyName: companies.name,
    plateNumber: vehicles.plateNumber,
    originCityId: manifests.originCityId,
    destinationCityId: manifests.destinationCityId
  }
  const latestBills = (
    when: typeof payments.paidAt | typeof payments.createdAt,
    which: SQL
  ): Promise<BillRow[]> =>
    db
      .select(billColumns)
      .from(payments)
      .innerJoin(manifests, eq(payments.manifestId, manifests.id))
      .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
      .innerJoin(companies, eq(manifests.companyId, companies.id))
      .where(and(which, gte(when, from), lt(when, to), inTrips(payments.manifestId)))
      .orderBy(desc(when), desc(payments.id))
      .limit(RECENT_BILLS)

  // Vehicle counts follow the vehicle and company filters only
  const vehicleScope = and(
    filters.vehicleType ? eq(vehicles.vehicleType, filters.vehicleType) : undefined
  )
  const companyCountQuery = filters.vehicleType
    ? db
        .select({ value: sql<number>`count(distinct ${vehicles.companyId})`.mapWith(Number) })
        .from(vehicles)
        .where(vehicleScope)
    : db.select({ value: count() }).from(companies)

  const byCargoQuery = figures.byCargo(from, to)
  const [
    [pending],
    [billed],
    previousRevenue,
    statusRows,
    latestPaid,
    latestUnpaid,
    companyRows,
    filled,
    byCargo,
    revenue,
    activeRows,
    issuedRows,
    vehicleRows,
    byTax,
    breakdown
  ] = await Promise.all([
    pendingQuery,
    billedQuery,
    previousRevenueQuery,
    statusQuery,
    latestBills(payments.paidAt, eq(payments.status, 'paid')),
    latestBills(payments.createdAt, ne(payments.status, 'paid')),
    companyCountQuery,
    // Every bucket of the range is filled in below, with the revenue of those that had any
    figures.series(from, to, bucket),
    byCargoQuery,
    figures.revenue(from, to),
    withTrips(
      db
        .select({ value: count() })
        .from(certificates)
        .innerJoin(manifests, eq(certificates.manifestId, manifests.id))
        .$dynamic(),
      null,
      and(eq(manifests.status, 'certified'), gte(certificates.validUntil, now))
    ),
    withTrips(
      db.select({ value: count() }).from(certificates).$dynamic(),
      certificates.manifestId,
      and(gte(certificates.issuedAt, from), lt(certificates.issuedAt, to))
    ),
    db.select({ value: count() }).from(vehicles).where(vehicleScope),
    figures.byTax(from, to),
    view.breakdown === 'cargoType'
      ? byCargoQuery.then((slices) =>
          slices.map((c) => ({ key: c.cargoType, revenue: c.revenue, trips: c.trips }))
        )
      : figures.breakdown(from, to, view.breakdown)
  ])

  const billedAmount = total(billed?.amount ?? null)
  const statusCounts = Object.fromEntries(MANIFEST_STATUSES.map((s) => [s, 0])) as Record<
    ManifestStatus,
    number
  >
  for (const row of statusRows) statusCounts[row.status] = row.value

  const recentBills = [...latestPaid, ...latestUnpaid]
    .map((bill) => ({ ...bill, at: (bill.paidAt ?? bill.createdAt).getTime() }))
    .sort((a, b) => b.at - a.at || b.id - a.id)
    .slice(0, RECENT_BILLS)

  const revenueSeries: RevenuePoint[] = []
  for (let at = bucketStart(from, bucket); at < to; at = nextBucket(at, bucket)) {
    revenueSeries.push(filled.get(at.getTime()) ?? { start: at.getTime(), revenue: 0, trips: 0 })
  }

  return {
    filters,
    from: from.getTime(),
    to: to.getTime(),
    bucket,
    breakdownBy: view.breakdown,
    generatedAt: now.getTime(),
    kpis: {
      revenue,
      previousRevenue,
      activeTrips: countOf(activeRows),
      pendingBills: pending?.bills ?? 0,
      pendingAmount: total(pending?.amount ?? null),
      certificatesIssued: countOf(issuedRows),
      collectionRate: billedAmount > 0 ? total(billed?.paid ?? 0) / billedAmount : null,
      vehicles: countOf(vehicleRows),
      companies: countOf(companyRows)
    },
    revenueSeries,
    byCargo,
    byTax,
    breakdown,
    statusCounts,
    recentBills: recentBills.map((bill) => ({
      manifestId: bill.manifestId,
      billId: bill.billId,
      amount: bill.amount,
      companyName: bill.companyName,
      plateNumber: bill.plateNumber,
      originCityId: bill.originCityId,
      destinationCityId: bill.destinationCityId,
      createdAt: bill.createdAt.getTime(),
      paidAt: bill.paidAt?.getTime() ?? null,
      status: bill.status === 'paid' ? 'paid' : 'pending'
    }))
  }
}

// The figures that describe the present, whatever the period: certified trips still valid, bills
// waiting for payment, the fleet and companies, and the latest bills of the range. Today's part of
// the dashboard carries them (services/dashboardFacts.ts); the trip filters apply as everywhere.
// They read the live and the archive tables, each on its own, never the all_* views: Postgres has
// no statistics for a view, so it planned these as scans of a month of trips (seconds each on a
// 2-core database). Bills waiting for payment are never archived, so they're counted live only.
export async function currentFigures(
  filters: AnalyticsFilters,
  from: Date,
  to: Date,
  now: Date = new Date()
): Promise<DashboardNow> {
  const db = getDb()
  type Tables = typeof archive
  // Each row joined to its trip by the trip's key when a trip filter is set (see getDashboard)
  const withTrips = <T extends PgSelect>(
    t: Tables,
    query: T,
    manifestId: Tables['payments']['manifestId'] | null,
    where: SQL | undefined
  ): T => {
    const tripFilter = tripConditions(filters, t)
    if (!tripFilter) return query.where(where) as unknown as T
    let joined = query as unknown as PgSelect
    if (manifestId) joined = joined.innerJoin(t.manifests, eq(manifestId, t.manifests.id)) as never
    joined = joined
      .innerJoin(vehicles, eq(t.manifests.vehicleId, vehicles.id))
      .innerJoin(originCity, eq(t.manifests.originCityId, originCity.id))
      .innerJoin(destinationCity, eq(t.manifests.destinationCityId, destinationCity.id)) as never
    return joined.where(and(where, tripFilter)) as unknown as T
  }
  const activeOf = (t: Tables): Promise<{ value: number }[]> =>
    withTrips(
      t,
      db
        .select({ value: count() })
        .from(t.certificates)
        .innerJoin(t.manifests, eq(t.certificates.manifestId, t.manifests.id))
        .$dynamic(),
      null,
      and(eq(t.manifests.status, 'certified'), gte(t.certificates.validUntil, now))
    )
  // The range's latest paid (or unpaid) bills in one set of tables
  const latestBills = (t: Tables, paid: boolean): Promise<BillRow[]> => {
    const when = paid ? t.payments.paidAt : t.payments.createdAt
    return db
      .select({
        id: t.payments.id,
        manifestId: t.payments.manifestId,
        billId: t.payments.billId,
        createdAt: t.payments.createdAt,
        paidAt: t.payments.paidAt,
        status: t.payments.status,
        amount: t.payments.amount,
        companyName: companies.name,
        plateNumber: vehicles.plateNumber,
        originCityId: t.manifests.originCityId,
        destinationCityId: t.manifests.destinationCityId
      })
      .from(t.payments)
      .innerJoin(t.manifests, eq(t.payments.manifestId, t.manifests.id))
      .innerJoin(vehicles, eq(t.manifests.vehicleId, vehicles.id))
      .innerJoin(companies, eq(t.manifests.companyId, companies.id))
      .where(
        and(
          paid ? eq(t.payments.status, 'paid') : ne(t.payments.status, 'paid'),
          gte(when, from),
          lt(when, to),
          inFilteredTrips(t.payments.manifestId, filters, t)
        )
      )
      .orderBy(desc(when), desc(t.payments.id))
      .limit(RECENT_BILLS)
  }
  const vehicleScope = filters.vehicleType
    ? eq(vehicles.vehicleType, filters.vehicleType)
    : undefined
  const countOf = (rows: { value: number }[]): number => rows[0]?.value ?? 0

  const [[pending], activeLive, activeArchived, vehicleRows, companyRows, ...latest] =
    await Promise.all([
      withTrips(
        liveTables,
        db
          .select({ bills: count(), amount: sum(livePayments.amount) })
          .from(livePayments)
          .$dynamic(),
        livePayments.manifestId,
        eq(livePayments.status, 'pending')
      ),
      activeOf(liveTables),
      activeOf(archive),
      db.select({ value: count() }).from(vehicles).where(vehicleScope),
      filters.vehicleType
        ? db
            .select({ value: sql<number>`count(distinct ${vehicles.companyId})`.mapWith(Number) })
            .from(vehicles)
            .where(vehicleScope)
        : db.select({ value: count() }).from(companies),
      latestBills(liveTables, true),
      latestBills(liveTables, false),
      latestBills(archive, true),
      latestBills(archive, false)
    ])
  const activeRows = [{ value: countOf(activeLive) + countOf(activeArchived) }]

  const recentBills = latest
    .flat()
    .map((bill) => ({ ...bill, at: (bill.paidAt ?? bill.createdAt).getTime() }))
    .sort((a, b) => b.at - a.at || b.id - a.id)
    .slice(0, RECENT_BILLS)
  return {
    activeTrips: countOf(activeRows),
    pendingBills: pending?.bills ?? 0,
    pendingAmount: total(pending?.amount ?? null),
    vehicles: countOf(vehicleRows),
    companies: countOf(companyRows),
    recentBills: recentBills.map((bill) => ({
      manifestId: bill.manifestId,
      billId: bill.billId,
      amount: bill.amount,
      companyName: bill.companyName,
      plateNumber: bill.plateNumber,
      originCityId: bill.originCityId,
      destinationCityId: bill.destinationCityId,
      createdAt: bill.createdAt.getTime(),
      paidAt: bill.paidAt?.getTime() ?? null,
      status: bill.status === 'paid' ? 'paid' : 'pending'
    }))
  }
}
