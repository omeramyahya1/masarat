// Government dashboard data. The API sends it in two parts the portal adds together: the history
// (every whole day up to yesterday, read from the nightly aggregates) and today (a small live query,
// with the figures that describe the present: active trips, pending bills, the latest bills). The
// portal keeps the history until the next night and asks only for today when refreshed.
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
} from './analytics'
import { MANIFEST_STATUSES, type CargoType, type ManifestStatus } from './fleet'

export type { BucketSize }

export interface DashboardKpis {
  // Paid in the period, and in the period of the same length before it (null when the records
  // don't reach back that far, so there's nothing fair to compare against)
  revenue: number
  previousRevenue: number | null
  // Certified trips whose permit hasn't expired (not limited to the period; other filters apply)
  activeTrips: number
  // Bills not paid yet (not limited to the period; other filters apply)
  pendingBills: number
  pendingAmount: number
  certificatesIssued: number
  // Paid amount / billed amount for bills issued in the period, 0..1; null when nothing was billed
  collectionRate: number | null
  vehicles: number
  companies: number
}

export interface RevenuePoint {
  // Bucket start, local time (ms)
  start: number
  revenue: number
  trips: number
}

// Passenger trips' revenue is one slice of its own
export const PASSENGERS_SLICE = 'passengers'

export interface CargoSlice {
  cargoType: CargoType | typeof PASSENGERS_SLICE
  revenue: number
  trips: number
}

// Revenue collected for one bill line (VAT, business profit, locality, manifest fee)
// A charge's revenue, under the name its latest bill was issued with
export interface TaxSlice {
  code: string
  name: string
  nameAr: string
  revenue: number
}

// One group of the breakdown card: a route, a state, a cargo type, … Routes carry their cities;
// companies their name; the other dimensions their key (a state name, a cargo type code, …)
export interface BreakdownRow {
  key: string
  originCityId?: number
  destinationCityId?: number
  name?: string
  revenue: number
  trips: number
}

export interface RecentBill {
  manifestId: number
  billId: string
  // When the bill was issued (ms)
  createdAt: number
  paidAt: number | null
  status: 'pending' | 'paid'
  amount: number
  companyName: string
  plateNumber: string
  originCityId: number
  destinationCityId: number
}

export interface DashboardData {
  filters: AnalyticsFilters
  // The range the figures cover, [from, to) in ms
  from: number
  to: number
  // The bucket size the series was built with, and the breakdown's dimension
  bucket: BucketSize
  breakdownBy: Breakdown
  generatedAt: number
  kpis: DashboardKpis
  revenueSeries: RevenuePoint[]
  byCargo: CargoSlice[]
  byTax: TaxSlice[]
  // Every group, by revenue; the card sorts and trims it
  breakdown: BreakdownRow[]
  // Manifests created in the range, by status
  statusCounts: Record<ManifestStatus, number>
  recentBills: RecentBill[]
}

// The breakdowns the transport-company rollup can't split by route or cargo: with an origin,
// destination or cargo filter, the company breakdown isn't offered
export const COMPANY_BREAKDOWN_FILTERS = ['category', 'vehicleType', 'tripKind'] as const

// What can be added up: the figures of a stretch of whole days (the history) or of today
export interface DashboardPart {
  // The stretch covered, [from, to) in ms
  from: number
  to: number
  revenue: number
  paidTrips: number
  // Revenue per day (YYYY-MM-DD), for the chart's buckets
  revenueByDay: { day: string; revenue: number; trips: number }[]
  byCargo: CargoSlice[]
  byTax: TaxSlice[]
  // Grouped by the view's breakdown
  breakdown: BreakdownRow[]
  statusCounts: Record<ManifestStatus, number>
  certificatesIssued: number
  // Bills issued in the stretch: their total, and how much of it is paid
  billedAmount: number
  billedPaidAmount: number
}

export interface DashboardHistory {
  part: DashboardPart
  // The period of the same length before the range (null when the records don't reach back)
  previousRevenue: number | null
  // The last day the nightly aggregates cover (YYYY-MM-DD); days after it were added live
  aggregatedThrough: string | null
}

// The present, which only today's request carries
export interface DashboardNow {
  activeTrips: number
  pendingBills: number
  pendingAmount: number
  vehicles: number
  companies: number
  recentBills: RecentBill[]
}

export interface DashboardToday {
  part: DashboardPart
  now: DashboardNow
}

// Where the range splits: whole days before `today` come from the history, the rest is today's
export function splitRange(
  filters: AnalyticsFilters,
  now: Date
): { from: Date; to: Date; today: Date; historyTo: Date; hasToday: boolean } {
  const { from, to } = resolveRange(filters.range, now)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const historyTo = to < today ? to : today
  return { from, to, today, historyTo, hasToday: to > today }
}

export const emptyPart = (from: number, to: number): DashboardPart => ({
  from,
  to,
  revenue: 0,
  paidTrips: 0,
  revenueByDay: [],
  byCargo: [],
  byTax: [],
  breakdown: [],
  statusCounts: Object.fromEntries(MANIFEST_STATUSES.map((s) => [s, 0])) as Record<
    ManifestStatus,
    number
  >,
  certificatesIssued: 0,
  billedAmount: 0,
  billedPaidAmount: 0
})

// Rows with the same key added together
function addBy<T>(rows: T[], keyOf: (row: T) => string, add: (into: T, row: T) => void): T[] {
  const merged = new Map<string, T>()
  for (const row of rows) {
    const key = keyOf(row)
    const existing = merged.get(key)
    if (existing) add(existing, row)
    else merged.set(key, { ...row })
  }
  return [...merged.values()]
}

// The dashboard as the portal shows it: the history and today added together
export function mergeDashboard(
  filters: AnalyticsFilters,
  view: DashboardView,
  now: Date,
  history: DashboardHistory,
  today: DashboardToday | null
): DashboardData {
  const { from, to } = resolveRange(filters.range, now)
  const bucket = resolveBucket(from, to, view.bucket)
  const parts = today ? [history.part, today.part] : [history.part]

  const buckets = new Map<number, RevenuePoint>()
  for (let at = bucketStart(from, bucket); at < to; at = nextBucket(at, bucket)) {
    buckets.set(at.getTime(), { start: at.getTime(), revenue: 0, trips: 0 })
  }
  for (const part of parts) {
    for (const row of part.revenueByDay) {
      const point = buckets.get(bucketStart(parseDay(row.day)!, bucket).getTime())
      if (!point) continue
      point.revenue += row.revenue
      point.trips += row.trips
    }
  }

  const statusCounts = { ...history.part.statusCounts }
  if (today) for (const s of MANIFEST_STATUSES) statusCounts[s] += today.part.statusCounts[s]
  const sum = (pick: (p: DashboardPart) => number): number =>
    parts.reduce((total, p) => total + pick(p), 0)
  const billed = sum((p) => p.billedAmount)
  const current: DashboardNow = today?.now ?? {
    activeTrips: 0,
    pendingBills: 0,
    pendingAmount: 0,
    vehicles: 0,
    companies: 0,
    recentBills: []
  }

  return {
    filters,
    from: from.getTime(),
    to: to.getTime(),
    bucket,
    breakdownBy: view.breakdown,
    generatedAt: now.getTime(),
    kpis: {
      revenue: sum((p) => p.revenue),
      previousRevenue: history.previousRevenue,
      activeTrips: current.activeTrips,
      pendingBills: current.pendingBills,
      pendingAmount: current.pendingAmount,
      certificatesIssued: sum((p) => p.certificatesIssued),
      collectionRate: billed > 0 ? sum((p) => p.billedPaidAmount) / billed : null,
      vehicles: current.vehicles,
      companies: current.companies
    },
    revenueSeries: [...buckets.values()],
    byCargo: addBy(
      parts.flatMap((p) => p.byCargo),
      (c) => c.cargoType,
      (into, c) => {
        into.revenue += c.revenue
        into.trips += c.trips
      }
    ).sort((a, b) => b.revenue - a.revenue),
    byTax: addBy(
      parts.flatMap((p) => p.byTax),
      (t) => t.code,
      (into, t) => {
        into.revenue += t.revenue
      }
    ).sort((a, b) => b.revenue - a.revenue),
    breakdown: addBy(
      parts.flatMap((p) => p.breakdown),
      (r) => r.key,
      (into, r) => {
        into.revenue += r.revenue
        into.trips += r.trips
      }
    ).sort((a, b) => b.revenue - a.revenue),
    statusCounts,
    recentBills: current.recentBills
  }
}
