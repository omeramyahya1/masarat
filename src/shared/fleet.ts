// Types and rules shared by the main process (fleet and trip services) and the renderer
import type { FeeSetting, TaxLine, TaxSetting } from './tax'

// Enum values, also used by the DB schema so the UI and services share one source of truth
export const VEHICLE_TYPES = [
  'heavy_duty_truck',
  'lorry',
  'light_duty_truck',
  'jumbo_truck',
  'tanker',
  'container_truck'
] as const
export const QUANTITY_UNITS = ['ton', 'liter'] as const
export const CARGO_TYPES = ['fuel', 'liquids', 'containers', 'general_cargo'] as const
// Units a cargo item can be entered in; each converts to its vehicle's capacity unit
export const ITEM_UNITS = ['kg', 'ton', 'liter', 'm3'] as const
export const MANIFEST_STATUSES = ['draft', 'billed', 'paid', 'certified', 'cancelled'] as const
export const PAYMENT_STATUSES = ['pending', 'paid', 'expired', 'failed'] as const

export type VehicleType = (typeof VEHICLE_TYPES)[number]
export type QuantityUnit = (typeof QUANTITY_UNITS)[number]
export type CargoType = (typeof CARGO_TYPES)[number]
export type ManifestStatus = (typeof MANIFEST_STATUSES)[number]
export type ItemUnit = (typeof ITEM_UNITS)[number]

const ITEM_UNITS_FOR: Record<QuantityUnit, readonly ItemUnit[]> = {
  ton: ['ton', 'kg'],
  liter: ['liter', 'm3']
}

// Item units that can be loaded on a vehicle measured in this unit
export const itemUnitsFor = (unit: QuantityUnit): readonly ItemUnit[] => ITEM_UNITS_FOR[unit]

// An item quantity in its vehicle's unit (kg -> ton, m3 -> liter)
export function toVehicleUnit(quantity: number, unit: ItemUnit): number {
  if (unit === 'kg') return quantity / 1000
  if (unit === 'm3') return quantity * 1000
  return quantity
}

// Sum of the items in the vehicle's unit, rounded to drop floating-point noise
export const totalInVehicleUnit = (
  items: readonly { quantity: number; unit: ItemUnit }[]
): number =>
  Math.round(items.reduce((sum, item) => sum + toVehicleUnit(item.quantity, item.unit), 0) * 1000) /
  1000

export const MAX_CARGO_ITEMS = 50
// رقم الترخيص: free text, at most this long
export const MAX_REGISTRATION_LENGTH = 30
export const MAX_DRIVER_NAME_LENGTH = 80
export const MAX_ITEM_NAME_LENGTH = 80

// Tankers carry liquids by default; everything else is measured in tons
export const defaultUnitFor = (type: VehicleType): QuantityUnit =>
  type === 'tanker' ? 'liter' : 'ton'

export interface VehicleInput {
  plateNumber: string
  registrationNo: string
  vehicleType: VehicleType
  capacity: number
  capacityUnit: QuantityUnit
}

export interface VehicleRecord extends Omit<VehicleInput, 'registrationNo'> {
  id: number
  // Null for vehicles added before registration numbers were recorded
  registrationNo: string | null
  // Vehicles with trips can't be deleted (manifests reference them)
  tripCount: number
  createdAt: number
}

// Phone numbers are stored without spaces or dashes: an optional "+" and 7 to 15 digits
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/
export function normalizePhone(value: string): string | null {
  const phone = value.replace(/[\s-]/g, '')
  return PHONE_PATTERN.test(phone) ? phone : null
}

export interface DriverInput {
  name: string
  phone: string
}

export interface DriverRecord extends DriverInput {
  id: number
  createdAt: number
}

export interface CityRecord {
  id: number
  name: string
  nameAr: string | null
  state: string
  lat: number
  lng: number
}

export interface TaxRateRecord {
  cargoType: CargoType
  ratePerKm: number
  unit: QuantityUnit
  perQuantity: number
}

export interface TripReferenceData {
  cities: CityRecord[]
  taxRates: TaxRateRecord[]
  // Current tax percentages and fees, for the form's preview
  taxSettings: TaxSetting[]
  feeSettings: FeeSetting[]
}

export interface CargoItem {
  name: string
  quantity: number
  unit: ItemUnit
  // Picks the item's rate; its unit has to match the vehicle's
  cargoType: CargoType
}

// A saved item, with the rate it was priced at and its share of the trip cost
export interface CargoItemRecord extends CargoItem {
  ratePerKm: number
  perQuantity: number
  cost: number
}

export interface TripInput {
  vehicleId: number
  originCityId: number
  destinationCityId: number
  items: CargoItem[]
  // Local calendar date, YYYY-MM-DD
  tripDate: string
}

export interface TripRecord {
  id: number
  vehicleId: number
  plateNumber: string
  vehicleType: VehicleType
  originCityId: number
  destinationCityId: number
  cargoType: CargoType
  cargoQuantity: number
  cargoUnit: QuantityUnit
  tripDate: number
  distanceKm: number
  ratePerKm: number
  // rate × distance × quantity; the taxes are percentages of it
  tripCost: number
  // Total of the tax lines; this is what the bill asks for
  taxAmount: number
  taxes: TaxLine[]
  items: CargoItemRecord[]
  status: ManifestStatus
  createdAt: number
}

export type FleetErrorCode =
  | 'not_signed_in'
  | 'missing_fields'
  | 'invalid_plate'
  | 'invalid_capacity'
  | 'plate_taken'
  | 'vehicle_not_found'
  | 'vehicle_in_use'
  | 'unit_in_use'
  | 'city_not_found'
  | 'same_route'
  | 'invalid_quantity'
  | 'unit_mismatch'
  | 'over_capacity'
  | 'invalid_date'
  | 'manifest_not_found'
  | 'already_billed'
  | 'not_billed'
  | 'invalid_items'
  | 'not_draft'
  | 'invalid_tax_rate'
  | 'invalid_fee'
  | 'invalid_registration'
  | 'invalid_phone'
  | 'phone_taken'
  | 'driver_not_found'
  | 'unknown'

export type FleetResult<T> = { ok: true; data: T } | { ok: false; error: FleetErrorCode }

// The cargo types a trip carries, main type first; trips from before cargo items existed have
// only their own
export function tripCargoTypes(trip: Pick<TripRecord, 'cargoType' | 'items'>): CargoType[] {
  if (trip.items.length === 0) return [trip.cargoType]
  const types = [...new Set(trip.items.map((item) => item.cargoType))]
  return [
    ...types.filter((type) => type === trip.cargoType),
    ...types.filter((type) => type !== trip.cargoType)
  ]
}
