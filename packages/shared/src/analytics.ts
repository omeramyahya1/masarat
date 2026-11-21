// Filters shared by the government dashboard, its PDF report, the raw data export and the
// government search. The main process turns them into query conditions; the renderer keeps them in
// its state and sends them over IPC.
import {
  CARGO_TYPES,
  TRIP_KINDS,
  VEHICLE_TYPES,
  type CargoType,
  type TripKind,
  type VehicleType
} from './fleet'

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
  // Matches a trip that carries this type in any of its items
  cargoType?: CargoType | null
  vehicleType?: VehicleType | null
  tripKind?: TripKind | null
  // A fleet owner (users.id)
  ownerId?: number | null
}

export const DEFAULT_FILTERS: AnalyticsFilters = { range: { preset: '30d' } }

// The filters other than the date range, in display order
export const FILTER_KEYS = [
  'originCityId',
  'originState',
  'destinationCityId',
  'destinationState',
  'cargoType',
  'vehicleType',
  'tripKind',
  'ownerId'
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
  'cargoType',
  'vehicleType',
  'tripKind',
  'owner'
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
// The longest custom range accepted
const MAX_RANGE_DAYS = 5 * 366

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

const isOneOf = <T>(list: readonly T[], value: unknown): value is T =>
  (list as readonly unknown[]).includes(value)
const optional = (value: unknown, check: (v: unknown) => boolean): boolean =>
  value === undefined || value === null || check(value)
const isId = (value: unknown): boolean => typeof value === 'number' && Number.isInteger(value)
const isText = (value: unknown): boolean =>
  typeof value === 'string' && value.length > 0 && value.length <= 80

function isDateRange(value: unknown): value is DateRange {
  const range = value as Partial<{ preset: unknown; from: unknown; to: unknown }> | null
  if (!range || typeof range !== 'object') return false
  if (isOneOf(RANGE_PRESETS, range.preset)) return true
  if (range.preset !== 'custom') return false
  const from = parseDay(range.from)
  const to = parseDay(range.to)
  return (
    from !== null &&
    to !== null &&
    from <= to &&
    (to.getTime() - from.getTime()) / DAY_MS <= MAX_RANGE_DAYS
  )
}

// IPC input comes from the renderer, so every field is checked
export function isAnalyticsFilters(value: unknown): value is AnalyticsFilters {
  const f = value as Record<string, unknown> | null
  if (!f || typeof f !== 'object' || !isDateRange(f.range)) return false
  return (
    optional(f.originCityId, isId) &&
    optional(f.destinationCityId, isId) &&
    optional(f.originState, isText) &&
    optional(f.destinationState, isText) &&
    optional(f.cargoType, (v) => isOneOf(CARGO_TYPES, v)) &&
    optional(f.vehicleType, (v) => isOneOf(VEHICLE_TYPES, v)) &&
    optional(f.tripKind, (v) => isOneOf(TRIP_KINDS, v)) &&
    optional(f.ownerId, isId)
  )
}

export function isDashboardView(value: unknown): value is DashboardView {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<DashboardView>
  return (
    (v.bucket === null || isOneOf(BUCKET_SIZES, v.bucket)) &&
    isOneOf(BREAKDOWNS, v.breakdown) &&
    isOneOf(BREAKDOWN_SORTS, v.sort)
  )
}

// A fleet owner, for the owner filter
export interface OwnerOption {
  id: number
  // Company name, or the owner's name when there is none
  name: string
}
