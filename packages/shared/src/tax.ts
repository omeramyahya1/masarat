// Trip cost and tax calculation, shared so the renderer can preview exactly what the main process
// saves
import {
  CARGO_TYPES,
  QUANTITY_UNITS,
  toVehicleUnit,
  type CargoItem,
  type CargoRateRecord,
  type CargoType
} from './fleet'

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

// What pricing_rates holds a rate for: each cargo type, and a passenger seat
export const PRICING_CODES = [...CARGO_TYPES, 'passenger'] as const
export const RATE_UNITS = QUANTITY_UNITS

// A passenger ticket: ratePerKm per seat × distance, in whole SDG
export const calculateTicketPrice = (ratePerKm: number, distanceKm: number): number =>
  Math.round(ratePerKm * distanceKm)

// trip cost = ratePerKm * distanceKm * (quantity / perQuantity), in whole SDG
export function calculateTripCost(
  rate: Pick<CargoRateRecord, 'ratePerKm' | 'perQuantity'>,
  distanceKm: number,
  quantity: number
): number {
  return Math.round((rate.ratePerKm * distanceKm * quantity) / rate.perQuantity)
}

// Each item priced at its cargo type's rate (its quantity converted to the rate's unit, which is
// the vehicle's). The trip cost is the sum; the main type is the one that costs the most.
// Null if an item's type has no rate.
export function calculateItemsCost(
  items: readonly Pick<CargoItem, 'cargoType' | 'quantity' | 'unit'>[],
  rates: readonly CargoRateRecord[],
  distanceKm: number
): { costs: number[]; total: number; mainType: CargoType | null } | null {
  const costs: number[] = []
  const byType = new Map<CargoType, number>()
  for (const item of items) {
    const rate = rates.find((r) => r.cargoType === item.cargoType)
    if (!rate) return null
    const cost = calculateTripCost(rate, distanceKm, toVehicleUnit(item.quantity, item.unit))
    costs.push(cost)
    byType.set(item.cargoType, (byType.get(item.cargoType) ?? 0) + cost)
  }
  let mainType: CargoType | null = null
  for (const [type, cost] of byType) {
    if (mainType === null || cost > (byType.get(mainType) ?? 0)) mainType = type
  }
  return { costs, total: costs.reduce((sum, cost) => sum + cost, 0), mainType }
}

// The taxes and fees on a bill ("charges"), managed by the government admin in Taxes and fees.
// A charge is a percentage of the trip cost (in basis points) or a fixed amount (whole SDG), and has
// its own value for cargo trips and for passenger trips: a null value means it isn't charged on
// that kind of trip. The four built-in ones can be renamed, changed and switched off but not
// removed; the admin adds custom ones.
export const CHARGE_KINDS = ['percent', 'fixed'] as const
export type ChargeKind = (typeof CHARGE_KINDS)[number]

export const TRIP_CATEGORIES = ['cargo', 'passenger'] as const
export type TripCategory = (typeof TRIP_CATEGORIES)[number]

export const BUILTIN_CHARGE_CODES = ['vat', 'business_profit', 'locality', 'manifest_fee'] as const

// Percentages are stored as basis points: 1700 = 17.00%
export const MAX_TAX_BPS = 10_000
// The largest fixed fee, in SDG
export const MAX_FEE = 1_000_000
export const MAX_CHARGE_NAME_LENGTH = 60

export interface ChargeRecord {
  id: number
  // The built-in ones' codes, or custom_<id>
  code: string
  name: string
  nameAr: string
  kind: ChargeKind
  // Basis points for a percentage, SDG for a fixed fee; null: not charged on that kind of trip
  cargoValue: number | null
  passengerValue: number | null
  // Switched off: not charged on new bills (bills already issued keep their lines)
  active: boolean
  builtin: boolean
}

// A line of a bill, frozen with the bill: the charge's name and value then. rateBps is null for a
// fixed fee.
export interface TaxLine {
  code: string
  name: string
  nameAr: string
  rateBps: number | null
  amount: number
}

export const chargeValueFor = (
  charge: Pick<ChargeRecord, 'cargoValue' | 'passengerValue'>,
  category: TripCategory
): number | null => (category === 'cargo' ? charge.cargoValue : charge.passengerValue)

// The active charges with a value for this kind of trip: the percentages first, each rounded to
// whole SDG, then the fixed fees, each in the order given. The total is their sum.
export function calculateCharges(
  tripCost: number,
  charges: readonly ChargeRecord[],
  category: TripCategory
): { lines: TaxLine[]; total: number } {
  const applied = charges.filter((c) => c.active && chargeValueFor(c, category) !== null)
  const line = (charge: ChargeRecord): TaxLine => {
    const value = chargeValueFor(charge, category) ?? 0
    const base = { code: charge.code, name: charge.name, nameAr: charge.nameAr }
    return charge.kind === 'percent'
      ? { ...base, rateBps: value, amount: Math.round((tripCost * value) / MAX_TAX_BPS) }
      : { ...base, rateBps: null, amount: value }
  }
  const lines = [
    ...applied.filter((c) => c.kind === 'percent').map(line),
    ...applied.filter((c) => c.kind === 'fixed').map(line)
  ]
  return { lines, total: lines.reduce((sum, l) => sum + l.amount, 0) }
}

// A value in range for its kind: whole basis points up to 100%, or whole SDG up to MAX_FEE
export const isChargeValue = (kind: ChargeKind, value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= (kind === 'percent' ? MAX_TAX_BPS : MAX_FEE)

// What can change about a charge; each change is logged
export const CHARGE_FIELDS = [
  'created',
  'name',
  'nameAr',
  'cargoValue',
  'passengerValue',
  'active'
] as const
export type ChargeField = (typeof CHARGE_FIELDS)[number]

// A logged change. Values as text: a number (basis points or SDG), a name, "true"/"false", or
// null for "doesn't apply"
export interface ChargeChange {
  chargeId: number
  // The charge's name and kind now, to label the entry
  name: string
  nameAr: string
  kind: ChargeKind
  field: ChargeField
  oldValue: string | null
  newValue: string | null
  // Full name of the government user who made it
  changedBy: string
  changedAt: number
}

export interface ChargesView {
  charges: ChargeRecord[]
  // Newest first
  history: ChargeChange[]
}

// A new charge, or a change to one (its kind is fixed once created)
export interface ChargeInput {
  name: string
  nameAr: string
  kind: ChargeKind
  cargoValue: number | null
  passengerValue: number | null
  active: boolean
}
