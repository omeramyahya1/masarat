// Trip cost and tax calculation, shared so the renderer can preview exactly what the main process
// saves
import type { TaxRateRecord } from './fleet'

interface Point {
  lat: number
  lng: number
}

const EARTH_RADIUS_KM = 6371

// Roads are longer than the straight line between two cities; this approximates the detour
// until a real routing service is integrated
export const ROAD_FACTOR = 1.3

export function haversineKm(a: Point, b: Point): number {
  const rad = (deg: number): number => (deg * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

// Estimated road distance, in whole km
export function estimateRoadKm(origin: Point, destination: Point): number {
  return Math.round(haversineKm(origin, destination) * ROAD_FACTOR)
}

// trip cost = ratePerKm * distanceKm * (quantity / perQuantity), in whole SDG
export function calculateTripCost(
  rate: Pick<TaxRateRecord, 'ratePerKm' | 'perQuantity'>,
  distanceKm: number,
  quantity: number
): number {
  return Math.round((rate.ratePerKm * distanceKm * quantity) / rate.perQuantity)
}

// The taxes charged on a trip, each a percentage of its trip cost. Government users can change
// the percentages; a trip keeps the ones it was billed with.
export const TAX_CODES = ['vat', 'business_profit', 'locality'] as const
export type TaxCode = (typeof TAX_CODES)[number]

// Percentages are stored as basis points: 1700 = 17.00%
export const DEFAULT_TAX_BPS: Record<TaxCode, number> = {
  vat: 1700,
  business_profit: 300,
  locality: 200
}
export const MAX_TAX_BPS = 10_000

export interface TaxSetting {
  code: TaxCode
  rateBps: number
}

export interface TaxLine extends TaxSetting {
  amount: number
}

export const isTaxCode = (value: unknown): value is TaxCode =>
  (TAX_CODES as readonly unknown[]).includes(value)

// One line per tax, in TAX_CODES order, each rounded to whole SDG; the total is their sum
export function calculateTaxes(
  tripCost: number,
  settings: readonly TaxSetting[]
): { lines: TaxLine[]; total: number } {
  const lines = TAX_CODES.map((code) => {
    const rateBps = settings.find((s) => s.code === code)?.rateBps ?? DEFAULT_TAX_BPS[code]
    return { code, rateBps, amount: Math.round((tripCost * rateBps) / MAX_TAX_BPS) }
  })
  return { lines, total: lines.reduce((sum, line) => sum + line.amount, 0) }
}

// A logged change to a tax percentage
export interface TaxChange {
  code: TaxCode
  oldBps: number
  newBps: number
  // Full name of the government user who made it
  changedBy: string
  changedAt: number
}

export interface TaxSettingsView {
  rates: TaxSetting[]
  // Newest first
  history: TaxChange[]
}

// New percentages in basis points, keyed by tax
export type TaxRatesInput = Partial<Record<TaxCode, number>>
