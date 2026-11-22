// Settings the government admin keeps (Government portal → Settings, govt.settings): how long a
// manifest stays valid after the estimated arrival, and the average speed the trip form suggests
// the arrival from, each per kind of trip.
import type { TripCategory } from './tax'

export interface SystemSettings {
  // Hours after the estimated arrival during which the documents stay valid
  validityMarginHours: Record<TripCategory, number>
  // km/h, for the suggested arrival time
  averageSpeedKmh: Record<TripCategory, number>
}

export const DEFAULT_SETTINGS: SystemSettings = {
  validityMarginHours: { cargo: 24, passenger: 24 },
  averageSpeedKmh: { cargo: 50, passenger: 70 }
}

export const MAX_VALIDITY_MARGIN_HOURS = 30 * 24
export const MIN_SPEED_KMH = 10
export const MAX_SPEED_KMH = 150

export const isValidSettings = (value: unknown): value is SystemSettings => {
  const v = value as SystemSettings
  const inRange = (n: unknown, min: number, max: number): boolean =>
    typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max
  return (
    Boolean(v) &&
    (['cargo', 'passenger'] as const).every(
      (c) =>
        inRange(v.validityMarginHours?.[c], 0, MAX_VALIDITY_MARGIN_HOURS) &&
        inRange(v.averageSpeedKmh?.[c], MIN_SPEED_KMH, MAX_SPEED_KMH)
    )
  )
}

const QUARTER_HOUR_MS = 15 * 60 * 1000

// The arrival the trip form suggests: departure + distance at the average speed, rounded up to
// the quarter hour
export function suggestedArrival(departure: Date, distanceKm: number, speedKmh: number): Date {
  const travel = (distanceKm / speedKmh) * 3_600_000
  return new Date(Math.ceil((departure.getTime() + travel) / QUARTER_HOUR_MS) * QUARTER_HOUR_MS)
}

// "YYYY-MM-DDTHH:MM" in local time, as the trip form's datetime inputs use
export function toLocalDateTime(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// "YYYY-MM-DDTHH:MM" as a local time, or null if it isn't a real date and time
export function parseLocalDateTime(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map(Number)
  if (hour > 23 || minute > 59) return null
  const date = new Date(year, month - 1, day, hour, minute)
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null
}
