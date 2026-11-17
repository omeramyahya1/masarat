// Government dashboard: totals and breakdowns across all fleet owners
import { and, count, desc, eq, gte, lt, sql, sum } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
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
import { MANIFEST_STATUSES, type CargoType, type ManifestStatus } from '../../shared/fleet'
import type {
  BucketSize,
  CargoSlice,
  DashboardData,
  DashboardPeriod,
  RevenuePoint
} from '../../shared/dashboard'

const TOP_ROUTES = 8
const RECENT_BILLS = 10

// Local midnight at the start of the period's first bucket
function periodStart(period: DashboardPeriod, now: Date): Date {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  if (period === '30d') start.setDate(start.getDate() - 29)
  else if (period === '90d') {
    // 13 weeks, each starting on Sunday (the first working day in Sudan)
    start.setDate(start.getDate() - 7 * 12 - start.getDay())
  } else {
    start.setDate(1)
    start.setMonth(start.getMonth() - 11)
  }
  return start
}

const BUCKETS: Record<DashboardPeriod, BucketSize> = { '30d': 'day', '90d': 'week', '12m': 'month' }

function nextBucket(date: Date, bucket: BucketSize): Date {
  const next = new Date(date)
  if (bucket === 'day') next.setDate(next.getDate() + 1)
  else if (bucket === 'week') next.setDate(next.getDate() + 7)
  else next.setMonth(next.getMonth() + 1)
  return next
}

// Empty buckets from start to now, then paid amounts dropped into them
function revenueSeries(start: Date, now: Date, bucket: BucketSize): RevenuePoint[] {
  const points: RevenuePoint[] = []
  for (let at = start; at <= now; at = nextBucket(at, bucket)) {
    points.push({ start: at.getTime(), revenue: 0, trips: 0 })
  }
  const paid = getDb()
    .select({ paidAt: payments.paidAt, amount: payments.amount })
    .from(payments)
    .where(and(eq(payments.status, 'paid'), gte(payments.paidAt, start)))
    .all()
  for (const { paidAt, amount } of paid) {
    if (!paidAt) continue
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
function revenueByCargo(start: Date): CargoSlice[] {
  const db = getDb()
  const paidInPeriod = and(eq(payments.status, 'paid'), gte(payments.paidAt, start))
  const paid = db
    .select({
      manifestId: payments.manifestId,
      amount: payments.amount,
      cargoType: manifests.cargoType
    })
    .from(payments)
    .innerJoin(manifests, eq(payments.manifestId, manifests.id))
    .where(paidInPeriod)
    .all()
  const items = new Map<number, { cargoType: CargoType; cost: number }[]>()
  for (const item of db
    .select({
      manifestId: manifestCargoItems.manifestId,
      cargoType: manifestCargoItems.cargoType,
      cost: manifestCargoItems.cost
    })
    .from(manifestCargoItems)
    .innerJoin(payments, eq(payments.manifestId, manifestCargoItems.manifestId))
    .where(paidInPeriod)
    .all()) {
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

export function getDashboard(period: DashboardPeriod): DashboardData {
  const db = getDb()
  const now = new Date()
  const start = periodStart(period, now)
  const previousStart = new Date(start.getTime() - (now.getTime() - start.getTime()))
  const bucket = BUCKETS[period]

  const paidBetween = (from: Date, to: Date): number =>
    total(
      db
        .select({ value: sum(payments.amount) })
        .from(payments)
        .where(
          and(eq(payments.status, 'paid'), gte(payments.paidAt, from), lt(payments.paidAt, to))
        )
        .get()?.value ?? null
    )

  const pending = db
    .select({ bills: count(), amount: sum(payments.amount) })
    .from(payments)
    .where(eq(payments.status, 'pending'))
    .get()

  const billed = db
    .select({
      amount: sum(payments.amount),
      paid: sql<number>`coalesce(sum(case when ${payments.status} = 'paid' then ${payments.amount} else 0 end), 0)`
    })
    .from(payments)
    .where(gte(payments.createdAt, start))
    .get()
  const billedAmount = total(billed?.amount ?? null)

  const firstPaidAt =
    db
      .select({ value: sql<Date | null>`min(${payments.paidAt})`.mapWith(payments.paidAt) })
      .from(payments)
      .where(eq(payments.status, 'paid'))
      .get()?.value ?? null
  const countOf = (rows: { value: number } | undefined): number => rows?.value ?? 0

  // Revenue breakdowns attribute each payment to the period it was paid in
  const paidInPeriod = and(eq(payments.status, 'paid'), gte(payments.paidAt, start))
  const revenue = sql<number>`sum(${payments.amount})`.mapWith(Number)

  const byCargo = revenueByCargo(start)

  // The paid trips' tax lines; together they add up to the revenue
  const taxRevenue = sql<number>`sum(${manifestTaxes.amount})`.mapWith(Number)
  const byTax = db
    .select({ code: manifestTaxes.code, revenue: taxRevenue })
    .from(payments)
    .innerJoin(manifestTaxes, eq(manifestTaxes.manifestId, payments.manifestId))
    .where(paidInPeriod)
    .groupBy(manifestTaxes.code)
    .orderBy(desc(taxRevenue))
    .all()

  const topRoutes = db
    .select({
      originCityId: manifests.originCityId,
      destinationCityId: manifests.destinationCityId,
      revenue,
      trips: count()
    })
    .from(payments)
    .innerJoin(manifests, eq(payments.manifestId, manifests.id))
    .where(paidInPeriod)
    .groupBy(manifests.originCityId, manifests.destinationCityId)
    .orderBy(desc(revenue))
    .limit(TOP_ROUTES)
    .all()

  const origin = alias(cities, 'origin')
  const byState = db
    .select({ state: origin.state, revenue, trips: count() })
    .from(payments)
    .innerJoin(manifests, eq(payments.manifestId, manifests.id))
    .innerJoin(origin, eq(manifests.originCityId, origin.id))
    .where(paidInPeriod)
    .groupBy(origin.state)
    .orderBy(desc(revenue))
    .all()

  const statusCounts = Object.fromEntries(MANIFEST_STATUSES.map((s) => [s, 0])) as Record<
    ManifestStatus,
    number
  >
  for (const row of db
    .select({ status: manifests.status, value: count() })
    .from(manifests)
    .where(gte(manifests.createdAt, start))
    .groupBy(manifests.status)
    .all()) {
    statusCounts[row.status] = row.value
  }

  const recentBills = db
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
    .orderBy(desc(sql`coalesce(${payments.paidAt}, ${payments.createdAt})`), desc(payments.id))
    .limit(RECENT_BILLS)
    .all()

  return {
    period,
    bucket,
    generatedAt: now.getTime(),
    kpis: {
      revenue: paidBetween(start, now),
      previousRevenue:
        firstPaidAt && firstPaidAt <= previousStart ? paidBetween(previousStart, start) : null,
      activeTrips: countOf(
        db
          .select({ value: count() })
          .from(certificates)
          .innerJoin(manifests, eq(certificates.manifestId, manifests.id))
          .where(and(eq(manifests.status, 'certified'), gte(certificates.validUntil, now)))
          .get()
      ),
      pendingBills: pending?.bills ?? 0,
      pendingAmount: total(pending?.amount ?? null),
      certificatesIssued: countOf(
        db
          .select({ value: count() })
          .from(certificates)
          .where(gte(certificates.issuedAt, start))
          .get()
      ),
      collectionRate: billedAmount > 0 ? total(billed?.paid ?? 0) / billedAmount : null,
      vehicles: countOf(db.select({ value: count() }).from(vehicles).get()),
      fleetOwners: countOf(
        db.select({ value: count() }).from(users).where(eq(users.role, 'owner')).get()
      )
    },
    revenueSeries: revenueSeries(start, now, bucket),
    byCargo,
    byTax,
    topRoutes,
    byState,
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
