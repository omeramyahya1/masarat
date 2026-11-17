// Government dashboard data, computed in the main process (src/main/services/dashboard.ts)
import type { CargoType, ManifestStatus } from './fleet'

export const DASHBOARD_PERIODS = ['30d', '90d', '12m'] as const
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number]

export const isDashboardPeriod = (value: unknown): value is DashboardPeriod =>
  (DASHBOARD_PERIODS as readonly unknown[]).includes(value)

// Revenue series bucket size for each period
export type BucketSize = 'day' | 'week' | 'month'

export interface DashboardKpis {
  // Paid in the period, and in the period of the same length before it (null when the records
  // don't reach back that far, so there's nothing fair to compare against)
  revenue: number
  previousRevenue: number | null
  // Certified trips whose certificate hasn't expired (not period-filtered)
  activeTrips: number
  // Bills not paid yet (not period-filtered)
  pendingBills: number
  pendingAmount: number
  certificatesIssued: number
  // Paid amount / billed amount for bills issued in the period, 0..1; null when nothing was billed
  collectionRate: number | null
  vehicles: number
  fleetOwners: number
}

export interface RevenuePoint {
  // Bucket start, local time (ms)
  start: number
  revenue: number
  trips: number
}

export interface CargoSlice {
  cargoType: CargoType
  revenue: number
  trips: number
}

export interface RouteRevenue {
  originCityId: number
  destinationCityId: number
  revenue: number
  trips: number
}

export interface StateRevenue {
  state: string
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
  period: DashboardPeriod
  bucket: BucketSize
  generatedAt: number
  kpis: DashboardKpis
  revenueSeries: RevenuePoint[]
  byCargo: CargoSlice[]
  topRoutes: RouteRevenue[]
  byState: StateRevenue[]
  // Manifests created in the period, by status
  statusCounts: Record<ManifestStatus, number>
  recentBills: RecentBill[]
}
