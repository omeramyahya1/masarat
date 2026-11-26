// Filters shared by the government dashboard, its PDF report, the raw data export and the
// government search. The API turns them into query conditions (their request schema is in
// schemas.ts); the portal keeps them in its state and sends them as JSON.
import type { CargoType, TripKind, VehicleType } from './fleet'
import type { TripCategory } from './tax'

export const RANGE_PRESETS = ['7d', '30d', '90d', '12m', 'ytd'] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]

// A preset ending now, or a custom range of local calendar days (YYYY-MM-DD, both included)
export type DateRange = { preset: RangePreset } | { preset: 'custom'; from: string; to: string }

export interface AnalyticsFilters {
  range: DateRange
  originCityId?: number | null
  destinationCityId?: number | null
  // A state name as stored in cities.state (e.g. "Khartoum")
  originState?: string | null
  destinationState?: string | null
  // Cargo or passenger trips
  category?: TripCategory | null
  // The trip's main cargo type (its costliest item's type): the dashboard's daily aggregates are
  // kept at that grain
  cargoType?: CargoType | null
  vehicleType?: VehicleType | null
  tripKind?: TripKind | null
}

export const DEFAULT_FILTERS: AnalyticsFilters = { range: { preset: '30d' } }

// The filters other than the date range, in display order
export const FILTER_KEYS = [
  'originCityId',
  'originState',
  'destinationCityId',
  'destinationState',
  'category',
  'cargoType',
  'vehicleType',
  'tripKind'
] as const
export type FilterKey = (typeof FILTER_KEYS)[number]

export const hasFilter = (filters: AnalyticsFilters, key: FilterKey): boolean =>
  filters[key] !== undefined && filters[key] !== null && filters[key] !== ''

export type BucketSize = 'day' | 'week' | 'month'
export const BUCKET_SIZES: readonly BucketSize[] = ['day', 'week', 'month']

// What the dashboard's breakdown card groups revenue by
export const BREAKDOWNS = [
  'route',
  'originState',
  'destinationState',
  'category',
  'cargoType',
  'vehicleType',
  'tripKind',
  'company'
] as const
export type Breakdown = (typeof BREAKDOWNS)[number]

export const BREAKDOWN_SORTS = ['revenue', 'trips', 'name'] as const
export type BreakdownSort = (typeof BREAKDOWN_SORTS)[number]

export interface DashboardView {
  // Null picks the size that suits the range (resolveBucket)
  bucket: BucketSize | null
  breakdown: Breakdown
  sort: BreakdownSort
}

export const DEFAULT_VIEW: DashboardView = { bucket: null, breakdown: 'route', sort: 'revenue' }

// Day buckets for a range this long or shorter, then weeks, then months
const MAX_DAY_BUCKETS = 45
const MAX_WEEK_BUCKETS = 200
// More points than this don't read as a chart
export const MAX_BUCKETS = 400
const DAY_MS = 86_400_000

const midnight = (date: Date): Date => {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy
}

// "YYYY-MM-DD" as local midnight, or null if it isn't a real calendar date
export function parseDay(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(year, month - 1, day)
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

// Local date as YYYY-MM-DD
export function formatDay(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// The range as [from, to): a preset runs from the start of its first day up to now; a custom range
// covers whole days, so `to` is the midnight after its last day
export function resolveRange(range: DateRange, now: Date): { from: Date; to: Date } {
  if (range.preset === 'custom') {
    const from = parseDay(range.from) ?? midnight(now)
    const last = parseDay(range.to) ?? midnight(now)
    const to = new Date(last)
    to.setDate(to.getDate() + 1)
    return { from, to }
  }
  const from = midnight(now)
  if (range.preset === '7d') from.setDate(from.getDate() - 6)
  else if (range.preset === '30d') from.setDate(from.getDate() - 29)
  else if (range.preset === '90d') from.setDate(from.getDate() - 89)
  else if (range.preset === '12m') {
    from.setDate(1)
    from.setMonth(from.getMonth() - 11)
  } else from.setMonth(0, 1)
  return { from, to: now }
}

// The first instant of the bucket a date falls in (weeks start on Sunday, the first working day
// in Sudan)
export function bucketStart(date: Date, bucket: BucketSize): Date {
  const start = midnight(date)
  if (bucket === 'week') start.setDate(start.getDate() - start.getDay())
  else if (bucket === 'month') start.setDate(1)
  return start
}

export function nextBucket(date: Date, bucket: BucketSize): Date {
  const next = new Date(date)
  if (bucket === 'day') next.setDate(next.getDate() + 1)
  else if (bucket === 'week') next.setDate(next.getDate() + 7)
  else next.setMonth(next.getMonth() + 1)
  return next
}

export function bucketCount(from: Date, to: Date, bucket: BucketSize): number {
  let count = 0
  for (
    let at = bucketStart(from, bucket);
    at < to && count <= MAX_BUCKETS;
    at = nextBucket(at, bucket)
  )
    count++
  return count
}

// The requested size if the range doesn't make too many points of it, else one that suits the range
export function resolveBucket(from: Date, to: Date, requested: BucketSize | null): BucketSize {
  if (requested && bucketCount(from, to, requested) <= MAX_BUCKETS) return requested
  const days = (to.getTime() - from.getTime()) / DAY_MS
  return days <= MAX_DAY_BUCKETS ? 'day' : days / 7 <= MAX_WEEK_BUCKETS ? 'week' : 'month'
}

// Bucket sizes worth offering for a range
export const bucketsFor = (from: Date, to: Date): BucketSize[] =>
  BUCKET_SIZES.filter((bucket) => bucketCount(from, to, bucket) <= MAX_BUCKETS)

// A transport company, for the company filter
export interface CompanyOption {
  id: number
  // The company's name
  name: string
}
