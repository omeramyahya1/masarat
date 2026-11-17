// Types and rules shared by the main process (fleet and trip services) and the renderer

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
export const CARGO_TYPES = ['fuel', 'containers', 'general_cargo'] as const
export const MANIFEST_STATUSES = ['draft', 'billed', 'paid', 'certified', 'cancelled'] as const
export const PAYMENT_STATUSES = ['pending', 'paid', 'expired', 'failed'] as const

export type VehicleType = (typeof VEHICLE_TYPES)[number]
export type QuantityUnit = (typeof QUANTITY_UNITS)[number]
export type CargoType = (typeof CARGO_TYPES)[number]
export type ManifestStatus = (typeof MANIFEST_STATUSES)[number]

// Tankers carry liquids by default; everything else is measured in tons
export const defaultUnitFor = (type: VehicleType): QuantityUnit =>
  type === 'tanker' ? 'liter' : 'ton'

export interface VehicleInput {
  plateNumber: string
  vehicleType: VehicleType
  capacity: number
  capacityUnit: QuantityUnit
}

export interface VehicleRecord extends VehicleInput {
  id: number
  // Vehicles with trips can't be deleted (manifests reference them)
  tripCount: number
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
}

export interface TripInput {
  vehicleId: number
  originCityId: number
  destinationCityId: number
  cargoType: CargoType
  cargoQuantity: number
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
  taxAmount: number
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
  | 'unknown'

export type FleetResult<T> = { ok: true; data: T } | { ok: false; error: FleetErrorCode }
