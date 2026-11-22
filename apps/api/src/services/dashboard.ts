// Government dashboard: totals and breakdowns across all fleet owners, for the filters chosen
import { and, count, desc, eq, gte, lt, sql, sum, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  certificates,
  cities,
  getDb,
  manifestCargoItems,
  manifestTaxes,
  manifests,
  payments,
  users,
  vehicles
} from '../db'
import { MANIFEST_STATUSES, type CargoType, type ManifestStatus } from '@masarat/shared/fleet'
import {
  bucketStart,
  nextBucket,
  resolveBucket,
  resolveRange,
  type AnalyticsFilters,
  type BucketSize,
  type DashboardView
} from '@masarat/shared/analytics'
import type {
  BreakdownRow,
  CargoSlice,
  DashboardData,
  RevenuePoint
} from '@masarat/shared/dashboard'
import { inFilteredTrips } from './analyticsQuery'

const RECENT_BILLS = 10

// Paid payments of filtered trips, paid in [from, to)
function paidIn(f: AnalyticsFilters, from: Date, to: Date): SQL | undefined {
  return and(
    eq(payments.status, 'paid'),
    gte(payments.paidAt, from),
    lt(payments.paidAt, to),
    inFilteredTrips(payments.manifestId, f)
  )
}

// Empty buckets covering [from, to), then the paid amounts dropped into them
async function revenueSeries(
  paid: SQL | undefined,
  from: Date,
  to: Date,
  bucket: BucketSize
): Promise<RevenuePoint[]> {
  const points: RevenuePoint[] = []
  for (let at = bucketStart(from, bucket); at < to; at = nextBucket(at, bucket)) {
    points.push({ start: at.getTime(), revenue: 0, trips: 0 })
  }
  const rows = await getDb()
    .select({ paidAt: payments.paidAt, amount: payments.amount })
    .from(payments)
    .where(paid)
  for (const { paidAt, amount } of rows) {
    if (!paidAt || points.length === 0) continue
    const time = paidAt.getTime()
    // Last bucket starting at or before the payment
    let index = points.length - 1
    while (index > 0 && points[index].start > time) index--
    points[index].revenue += amount
    points[index].trips += 1
  }
  return points
}

const total = (value: string | number | null): number => Number(value ?? 0)

// Each paid trip's taxes split across its cargo items in proportion to their cost (a trip can
// mix cargo types). Trips from before cargo items existed count under their own cargo type.
async function revenueByCargo(paidInPeriod: SQL | undefined): Promise<CargoSlice[]> {
  const db = getDb()
  const paid = await db
    .select({
      manifestId: payments.manifestId,
      amount: payments.amount,
      cargoType: manifests.cargoType
    })
    .from(payments)
    .innerJoin(manifests, eq(payments.manifestId, manifests.id))
    .where(paidInPeriod)
  const items = new Map<number, { cargoType: CargoType; cost: number }[]>()
  for (const item of await db
    .select({
      manifestId: manifestCargoItems.manifestId,
      cargoType: manifestCargoItems.cargoType,
      cost: manifestCargoItems.cost
    })
    .from(manifestCargoItems)
    .innerJoin(payments, eq(payments.manifestId, manifestCargoItems.manifestId))
    .where(paidInPeriod)) {
    const list = items.get(item.manifestId) ?? []
    list.push(item)
    items.set(item.manifestId, list)
  }

  const slices = new Map<CargoType, { revenue: number; trips: Set<number> }>()
  const add = (cargoType: CargoType, revenue: number, manifestId: number): void => {
    const slice = slices.get(cargoType) ?? { revenue: 0, trips: new Set<number>() }
    slice.revenue += revenue
    slice.trips.add(manifestId)
    slices.set(cargoType, slice)
  }
  for (const trip of paid) {
    const tripItems = items.get(trip.manifestId) ?? []
    const cost = tripItems.reduce((sum, item) => sum + item.cost, 0)
    if (cost <= 0) {
      add(trip.cargoType, trip.amount, trip.manifestId)
      continue
    }
    for (const item of tripItems)
      add(item.cargoType, (trip.amount * item.cost) / cost, trip.manifestId)
  }
  return [...slices]
    .map(([cargoType, slice]) => ({
      cargoType,
      revenue: Math.round(slice.revenue),
      trips: slice.trips.size
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

// Revenue grouped by the breakdown's dimension, every group, by revenue
async function breakdown(
  view: DashboardView,
  paid: SQL | undefined,
  byCargo: CargoSlice[]
): Promise<BreakdownRow[]> {
  const db = getDb()
  const revenue = sql<number>`sum(${payments.amount})`.mapWith(Number)
  switch (view.breakdown) {
    case 'route':
      return (
        await db
          .select({
            originCityId: manifests.originCityId,
            destinationCityId: manifests.destinationCityId,
            revenue,
            trips: count()
          })
          .from(payments)
          .innerJoin(manifests, eq(payments.manifestId, manifests.id))
          .where(paid)
          .groupBy(manifests.originCityId, manifests.destinationCityId)
          .orderBy(desc(revenue))
      ).map((r) => ({ key: `${r.originCityId}-${r.destinationCityId}`, ...r }))
    case 'originState':
    case 'destinationState': {
      const city = alias(cities, 'breakdown_city')
      const cityId =
        view.breakdown === 'originState' ? manifests.originCityId : manifests.destinationCityId
      return db
        .select({ key: city.state, revenue, trips: count() })
        .from(payments)
        .innerJoin(manifests, eq(payments.manifestId, manifests.id))
        .innerJoin(city, eq(cityId, city.id))
        .where(paid)
        .groupBy(city.state)
        .orderBy(desc(revenue))
    }
    // Split across each trip's items like the cargo card, so the two agree
    case 'cargoType':
      return byCargo.map((c) => ({ key: c.cargoType, revenue: c.revenue, trips: c.trips }))
    case 'vehicleType':
      return db
        .select({ key: vehicles.vehicleType, revenue, trips: count() })
        .from(payments)
        .innerJoin(manifests, eq(payments.manifestId, manifests.id))
        .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
        .where(paid)
        .groupBy(vehicles.vehicleType)
        .orderBy(desc(revenue))
    case 'tripKind':
      return db
        .select({ key: manifests.tripKind, revenue, trips: count() })
        .from(payments)
        .innerJoin(manifests, eq(payments.manifestId, manifests.id))
        .where(paid)
        .groupBy(manifests.tripKind)
        .orderBy(desc(revenue))
    case 'owner':
      return (
        await db
          .select({
            id: users.id,
            companyName: users.companyName,
            fullName: users.fullName,
            revenue,
            trips: count()
          })
          .from(payments)
          .innerJoin(manifests, eq(payments.manifestId, manifests.id))
          .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
          .innerJoin(users, eq(vehicles.ownerId, users.id))
          .where(paid)
          .groupBy(users.id)
          .orderBy(desc(revenue))
      ).map((r) => ({
        key: String(r.id),
        name: r.companyName || r.fullName,
        revenue: r.revenue,
        trips: r.trips
      }))
  }
}

export async function getDashboard(
  filters: AnalyticsFilters,
  view: DashboardView
): Promise<DashboardData> {
  const db = getDb()
  const now = new Date()
  const { from, to } = resolveRange(filters.range, now)
  const previousFrom = new Date(from.getTime() - (to.getTime() - from.getTime()))
  const bucket = resolveBucket(from, to, view.bucket)
  // Trips matching the route / cargo / vehicle / owner filters
  const inTrips = (column: Parameters<typeof inFilteredTrips>[0]): SQL | undefined =>
    inFilteredTrips(column, filters)

  const paidBetween = async (start: Date, end: Date): Promise<number> => {
    const [row] = await db
      .select({ value: sum(payments.amount) })
      .from(payments)
      .where(paidIn(filters, start, end))
    return total(row?.value ?? null)
  }

  const [pending] = await db
    .select({ bills: count(), amount: sum(payments.amount) })
    .from(payments)
    .where(and(eq(payments.status, 'pending'), inTrips(payments.manifestId)))

  const [billed] = await db
    .select({
      amount: sum(payments.amount),
      paid: sql<number>`coalesce(sum(case when ${payments.status} = 'paid' then ${payments.amount} else 0 end), 0)`.mapWith(
        Number
      )
    })
    .from(payments)
    .where(
      and(gte(payments.createdAt, from), lt(payments.createdAt, to), inTrips(payments.manifestId))
    )
  const billedAmount = total(billed?.amount ?? null)

  const [first] = await db
    .select({ value: sql<Date | null>`min(${payments.paidAt})`.mapWith(payments.paidAt) })
    .from(payments)
    .where(eq(payments.status, 'paid'))
  const firstPaidAt = first?.value ?? null
  const countOf = (rows: { value: number }[]): number => rows[0]?.value ?? 0

  // Revenue breakdowns attribute each payment to the range it was paid in
  const paidInPeriod = paidIn(filters, from, to)

  const byCargo = await revenueByCargo(paidInPeriod)

  // The paid trips' tax lines; together they add up to the revenue
  const taxRevenue = sql<number>`sum(${manifestTaxes.amount})`.mapWith(Number)
  const byTax = await db
    .select({ code: manifestTaxes.code, revenue: taxRevenue })
    .from(payments)
    .innerJoin(manifestTaxes, eq(manifestTaxes.manifestId, payments.manifestId))
    .where(paidInPeriod)
    .groupBy(manifestTaxes.code)
    .orderBy(desc(taxRevenue))

  const statusCounts = Object.fromEntries(MANIFEST_STATUSES.map((s) => [s, 0])) as Record<
    ManifestStatus,
    number
  >
  for (const row of await db
    .select({ status: manifests.status, value: count() })
    .from(manifests)
    .where(and(gte(manifests.createdAt, from), lt(manifests.createdAt, to), inTrips(manifests.id)))
    .groupBy(manifests.status)) {
    statusCounts[row.status] = row.value
  }

  const billedOrPaidAt = sql`coalesce(${payments.paidAt}, ${payments.createdAt})`
  const recentBills = await db
    .select({
      manifestId: payments.manifestId,
      billId: payments.billId,
      createdAt: payments.createdAt,
      paidAt: payments.paidAt,
      status: payments.status,
      amount: payments.amount,
      companyName: users.companyName,
      fullName: users.fullName,
      plateNumber: vehicles.plateNumber,
      originCityId: manifests.originCityId,
      destinationCityId: manifests.destinationCityId
    })
    .from(payments)
    .innerJoin(manifests, eq(payments.manifestId, manifests.id))
    .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
    .innerJoin(users, eq(vehicles.ownerId, users.id))
    .where(
      and(
        sql`${billedOrPaidAt} >= ${from.toISOString()}`,
        sql`${billedOrPaidAt} < ${to.toISOString()}`,
        inTrips(payments.manifestId)
      )
    )
    .orderBy(desc(billedOrPaidAt), desc(payments.id))
    .limit(RECENT_BILLS)

  // Vehicle counts follow the vehicle and owner filters only
  const vehicleScope = and(
    filters.vehicleType ? eq(vehicles.vehicleType, filters.vehicleType) : undefined,
    filters.ownerId ? eq(vehicles.ownerId, filters.ownerId) : undefined
  )
  const owners =
    filters.vehicleType || filters.ownerId
      ? countOf(
          await db
            .select({ value: sql<number>`count(distinct ${vehicles.ownerId})`.mapWith(Number) })
            .from(vehicles)
            .where(vehicleScope)
        )
      : countOf(await db.select({ value: count() }).from(users).where(eq(users.role, 'owner')))

  return {
    filters,
    from: from.getTime(),
    to: to.getTime(),
    bucket,
    breakdownBy: view.breakdown,
    generatedAt: now.getTime(),
    kpis: {
      revenue: await paidBetween(from, to),
      previousRevenue:
        firstPaidAt && firstPaidAt <= previousFrom ? await paidBetween(previousFrom, from) : null,
      activeTrips: countOf(
        await db
          .select({ value: count() })
          .from(certificates)
          .innerJoin(manifests, eq(certificates.manifestId, manifests.id))
          .where(
            and(
              eq(manifests.status, 'certified'),
              gte(certificates.validUntil, now),
              inTrips(manifests.id)
            )
          )
      ),
      pendingBills: pending?.bills ?? 0,
      pendingAmount: total(pending?.amount ?? null),
      certificatesIssued: countOf(
        await db
          .select({ value: count() })
          .from(certificates)
          .where(
            and(
              gte(certificates.issuedAt, from),
              lt(certificates.issuedAt, to),
              inTrips(certificates.manifestId)
            )
          )
      ),
      collectionRate: billedAmount > 0 ? total(billed?.paid ?? 0) / billedAmount : null,
      vehicles: countOf(await db.select({ value: count() }).from(vehicles).where(vehicleScope)),
      fleetOwners: owners
    },
    revenueSeries: await revenueSeries(paidInPeriod, from, to, bucket),
    byCargo,
    byTax,
    breakdown: await breakdown(view, paidInPeriod, byCargo),
    statusCounts,
    recentBills: recentBills.map(
      ({ fullName, companyName, createdAt, paidAt, status, ...bill }) => ({
        ...bill,
        // Owners without a company show their own name
        companyName: companyName || fullName,
        createdAt: createdAt.getTime(),
        paidAt: paidAt?.getTime() ?? null,
        status: status === 'paid' ? 'paid' : 'pending'
      })
    )
  }
}
