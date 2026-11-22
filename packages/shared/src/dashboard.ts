// Government dashboard data, computed in the main process (src/main/services/dashboard.ts)
import type { AnalyticsFilters, Breakdown, BucketSize } from './analytics'
import type { CargoType, ManifestStatus } from './fleet'

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
