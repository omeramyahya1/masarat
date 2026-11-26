// Types and rules shared by the main process (fleet and trip services) and the renderer
import type { PassengerInput, PassengerRecord } from './passengers'
import type { ChargeRecord, TaxLine, TripCategory } from './tax'
import type { PageSize } from './paging'

// Enum values, also used by the DB schema so the UI and services share one source of truth
export const VEHICLE_TYPES = [
  'heavy_duty_truck',
  'lorry',
  'light_duty_truck',
  'jumbo_truck',
  'tanker',
  'container_truck',
  // Carries passengers: its capacity is its seats
  'bus'
] as const
export const QUANTITY_UNITS = ['ton', 'liter', 'seat'] as const
export const CARGO_TYPES = ['fuel', 'liquids', 'containers', 'general_cargo'] as const
// Units a cargo item can be entered in; each converts to its vehicle's capacity unit
export const ITEM_UNITS = ['kg', 'ton', 'liter', 'm3'] as const
// revoked: a supervisor revoked the issued clearance (certified before). cancelled: a supervisor
// cancelled the trip while its bill was unpaid. Both are final (packages/shared/src/reviews.ts).
export const MANIFEST_STATUSES = [
  'draft',
  'billed',
  'paid',
  'certified',
  'revoked',
  'cancelled'
] as const
// cancelled: the trip was cancelled before its bill was paid, so the bill no longer counts
export const PAYMENT_STATUSES = ['pending', 'paid', 'expired', 'failed', 'cancelled'] as const
// Domestic, or crossing the border (imports need a certificate of origin and an authorization)
export const TRIP_KINDS = ['domestic', 'import', 'export'] as const
// Supporting documents a trip can have attached
export const DOCUMENT_TYPES = [
  'commercial_invoice',
  'packing_list',
  'certificate_of_origin',
  'trade_authorization'
] as const

export type VehicleType = (typeof VEHICLE_TYPES)[number]
export type QuantityUnit = (typeof QUANTITY_UNITS)[number]
// What a truck or tanker is measured in (a bus is counted in seats)
export type CargoUnit = Exclude<QuantityUnit, 'seat'>
export type CargoType = (typeof CARGO_TYPES)[number]
export type ManifestStatus = (typeof MANIFEST_STATUSES)[number]
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]
export type ItemUnit = (typeof ITEM_UNITS)[number]
export type TripKind = (typeof TRIP_KINDS)[number]
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

// A bus carries passengers; every other vehicle carries cargo
export const tripCategoryFor = (type: VehicleType): TripCategory =>
  type === 'bus' ? 'passenger' : 'cargo'

// The documents that apply to a trip of this kind: the invoice and packing list always, the
// certificate of origin for imports, and the import/export authorization for both. Passenger
// trips have none for now.
export function documentTypesFor(kind: TripKind, category: TripCategory = 'cargo'): DocumentType[] {
  if (category === 'passenger') return []
  return DOCUMENT_TYPES.filter(
    (type) =>
      (type !== 'certificate_of_origin' || kind === 'import') &&
      (type !== 'trade_authorization' || kind !== 'domestic')
  )
}

// Attachments: PDF or images, up to 20 MB each
export const DOCUMENT_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png'] as const
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

const ITEM_UNITS_FOR: Record<QuantityUnit, readonly ItemUnit[]> = {
  ton: ['ton', 'kg'],
  liter: ['liter', 'm3'],
  // A bus carries passengers, not cargo items
  seat: []
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
export const MAX_TRAILERS = 3
export const MAX_PARTY_NAME_LENGTH = 120
export const MAX_PARTY_ADDRESS_LENGTH = 200
export const MAX_PACKING_LENGTH = 40
export const MAX_NOTES_LENGTH = 200
export const MAX_PACKAGE_COUNT = 1_000_000

// Common packing types, offered as suggestions (labels in packingTypes.*). The field is free text:
// what's stored is the text the member picked or typed.
export const PACKING_SUGGESTIONS = [
  'barrels',
  'sacks',
  'packages',
  'cartons',
  'boxes',
  'pallets',
  'bales',
  'bulk'
] as const
export const MAX_ITEM_NAME_LENGTH = 80

// Tankers carry liquids, buses seat passengers; everything else is measured in tons
export const defaultUnitFor = (type: VehicleType): QuantityUnit =>
  type === 'tanker' ? 'liter' : type === 'bus' ? 'seat' : 'ton'

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

// Senders' and receivers' phones (they may be abroad on imports and exports): stored without
// spaces or dashes, an optional "+" and 7 to 15 digits. Accounts and drivers use phone.ts.
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
  // Trips naming this driver
  tripCount: number
  createdAt: number
}

export interface CityRecord {
  id: number
  name: string
  nameAr: string
  // The state's English name (unique, used as its key in filters) and Arabic name
  state: string
  stateAr: string
  lat: number
  lng: number
}

// A cargo type's price per km (pricing_rates; the development formula, see services/pricing.ts)
export interface CargoRateRecord {
  cargoType: CargoType
  ratePerKm: number
  unit: QuantityUnit
  perQuantity: number
}

export interface TripReferenceData {
  cities: CityRecord[]
  cargoRates: CargoRateRecord[]
  // A passenger ticket's price per km per seat
  ticketRatePerKm: number
  // The taxes and fees as they are now, for the form's preview
  charges: ChargeRecord[]
  // km/h per kind of trip, for the suggested arrival (the government's settings)
  averageSpeedKmh: Record<TripCategory, number>
}

export interface CargoItem {
  name: string
  // The weight (or volume) in `unit`; drives the cost and the capacity check
  quantity: number
  unit: ItemUnit
  // Picks the item's rate; its unit has to match the vehicle's
  cargoType: CargoType
  // How it's packed and how many packages; drafts may leave them empty, a bill needs them
  packingType: string | null
  packageCount: number | null
  notes: string | null
}

// A file attached to a saved trip
export interface TripDocumentRecord {
  id: number
  docType: DocumentType
  fileName: string
  size: number
  createdAt: number
}

// A file picked on the trip form but not saved with a trip yet; `token` names it in staging
export interface StagedDocument {
  token: string
  docType: DocumentType
  fileName: string
  size: number
}

// A trip's attachments as the form sends them: kept ones by id, new ones by staging token
export type TripDocumentInput = { docType: DocumentType } & ({ id: number } | { token: string })

// A sender (shipper) or receiver. Empty strings while a draft leaves them out.
export interface Party {
  name: string
  address: string
  phone: string
}

// The company as carrier, copied onto the manifest when its bill is generated
export interface CarrierDetails {
  name: string
  address: string
  tin: string
}

// A saved item, with the rate it was priced at and its share of the trip cost
export interface CargoItemRecord extends CargoItem {
  ratePerKm: number
  perQuantity: number
  cost: number
}

export interface TripInput {
  // The branch it's booked at; a branch member's own branch is used whatever this says
  branchId?: number | null
  vehicleId: number
  originCityId: number
  destinationCityId: number
  // A cargo trip's load; empty for a passenger trip
  items: CargoItem[]
  // A passenger trip's passengers (a bus); omitted or empty for cargo
  passengers?: PassengerInput[]
  // Local date and time, YYYY-MM-DDTHH:MM, Sudan time. The arrival is the estimate.
  departureAt: string
  arrivalAt: string
  // Ignored for a passenger trip, which is always domestic
  tripKind: TripKind
  // Trailer plates, as stored ("KH 12/34567"), in order
  trailers: string[]
  // One of the company's drivers; drafts may leave it empty
  driverId: number | null
  shipper: Party
  receiver: Party
  // One per document type at most; omitted means none
  documents?: TripDocumentInput[]
}

export interface TripRecord {
  id: number
  branchId: number
  branchName: string
  vehicleId: number
  plateNumber: string
  vehicleType: VehicleType
  registrationNo: string | null
  originCityId: number
  destinationCityId: number
  // From the vehicle: a bus's trips carry passengers
  category: TripCategory
  // A cargo trip's main type (the costliest); null for passengers
  cargoType: CargoType | null
  // The load in the vehicle's unit; a passenger trip's tickets (seats sold, infants not counted)
  cargoQuantity: number
  cargoUnit: QuantityUnit
  departureAt: number
  // The estimated arrival
  arrivalAt: number
  distanceKm: number
  // Cargo: the main type's rate; passengers: the ticket rate per km
  ratePerKm: number
  // A passenger ticket's price; null for cargo
  ticketPrice: number | null
  // Cargo: rate × distance × quantity per item; passengers: ticket price × tickets. The taxes are
  // percentages of it.
  tripCost: number
  // Total of the tax lines; this is what the bill asks for
  taxAmount: number
  taxes: TaxLine[]
  items: CargoItemRecord[]
  passengers: PassengerRecord[]
  status: ManifestStatus
  createdAt: number
  tripKind: TripKind
  trailers: string[]
  driverId: number | null
  // The driver's name and phone as the manifest prints them
  driverName: string | null
  driverPhone: string | null
  shipper: Party
  receiver: Party
  // Set when the bill is generated
  carrier: CarrierDetails | null
  documents: TripDocumentRecord[]
}

// Earlier senders and receivers and packing types, suggested on the trip form
export interface TripSuggestions {
  parties: Party[]
  packingTypes: string[]
}

// What a draft still needs before its bill can be generated
export const BILLING_REQUIREMENTS = [
  'driver',
  'shipper',
  'receiver',
  'packing',
  // A passenger trip: at least one ticket, and an ID for everyone who has a seat
  'passengers',
  'passenger_ids',
  'carrier_address',
  'carrier_tin'
] as const
export type BillingRequirement = (typeof BILLING_REQUIREMENTS)[number]

const isComplete = (party: Party): boolean =>
  Boolean(party.name.trim() && party.address.trim() && party.phone.trim())

export function missingForBilling(
  trip: Pick<TripRecord, 'category' | 'driverId' | 'shipper' | 'receiver' | 'items' | 'passengers'>,
  company: { address: string | null; tin: string | null }
): BillingRequirement[] {
  const cargo = trip.category === 'cargo'
  const seated = trip.passengers.filter((p) => !p.isInfant)
  const met: Record<BillingRequirement, boolean> = {
    driver: trip.driverId !== null,
    shipper: !cargo || isComplete(trip.shipper),
    receiver: !cargo || isComplete(trip.receiver),
    packing:
      !cargo ||
      (trip.items.length > 0 &&
        trip.items.every(
          (item) => Boolean(item.packingType?.trim()) && item.packageCount !== null
        )),
    passengers: cargo || seated.length > 0,
    passenger_ids: cargo || seated.every((p) => p.idType !== null && p.idNumber !== null),
    carrier_address: Boolean(company.address?.trim()),
    carrier_tin: Boolean(company.tin?.trim())
  }
  return BILLING_REQUIREMENTS.filter((requirement) => !met[requirement])
}

export type FleetErrorCode =
  | 'not_signed_in'
  // A trip is booked at an active branch of the company
  | 'branch_required'
  | 'branch_not_found'
  | 'branch_inactive'
  | 'missing_fields'
  | 'invalid_plate'
  | 'invalid_capacity'
  | 'plate_taken'
  | 'vehicle_not_found'
  | 'vehicle_in_use'
  | 'unit_in_use'
  | 'city_not_found'
  | 'same_route'
  // The estimated arrival has to be after the departure
  | 'invalid_arrival'
  // Passengers: names, IDs, seats within the bus, an infant on a passenger's seat
  | 'invalid_passengers'
  | 'seat_taken'
  | 'template_not_found'
  | 'invalid_template'
  | 'invalid_settings'
  | 'invalid_quantity'
  | 'unit_mismatch'
  | 'over_capacity'
  | 'invalid_date'
  // A trips list period that isn't a valid range of at most MAX_PERIOD_DAYS days
  | 'invalid_period'
  | 'manifest_not_found'
  | 'already_billed'
  | 'not_billed'
  | 'invalid_items'
  | 'not_draft'
  | 'invalid_tax_rate'
  // A charge needs a name in both languages (up to 60 characters) and a value for at least one
  // kind of trip
  | 'invalid_charge'
  | 'charge_not_found'
  | 'invalid_fee'
  | 'invalid_registration'
  | 'invalid_phone'
  | 'phone_taken'
  | 'driver_not_found'
  | 'driver_in_use'
  | 'invalid_trailer'
  | 'invalid_party'
  | 'incomplete_manifest'
  | 'invalid_document'
  | 'document_too_large'
  | 'zero_bill'
  // Reviews (packages/shared/src/reviews.ts): only an issued clearance can be reported or revoked
  | 'not_certified'
  // Only a trip whose bill is still unpaid can be cancelled
  | 'not_pending'
  // The trip was cancelled by a supervisor: it can't be paid or authorized any more
  | 'trip_cancelled'
  // The trip already has an open report (a supervisor is reviewing it)
  | 'report_open'
  | 'report_not_found'
  // The report was already dismissed or acted on
  | 'report_closed'
  // A report or decision needs a reason and a note of up to 500 characters
  | 'invalid_review'
  // The account may not do this (another role, not an admin, or a demo-only action)
  | 'forbidden'
  // The account must replace its temporary password first
  | 'password_change_required'
  // A query ran past the server's time limit (narrow the search or the period)
  | 'query_timeout'
  // A dataset has more rows than an Excel sheet holds (choose CSV or a shorter period)
  | 'export_too_large_for_excel'
  // An export too big to send as one ZIP (choose a shorter period, or fewer datasets or formats)
  | 'export_too_large'
  // The account already has an export queued or being prepared (one at a time)
  | 'export_in_progress'
  // No such export for this account (or its file has expired)
  | 'export_not_found'
  // The export's file isn't ready yet
  | 'export_not_ready'
  // The export stopped on the server (an error, or the worker stopped); start it again
  | 'export_failed'
  | 'unknown'

export type FleetResult<T> = { ok: true; data: T } | { ok: false; error: FleetErrorCode }

// The cargo types a trip carries, main type first; trips from before cargo items existed have
// only their own, and a passenger trip none
export function tripCargoTypes(trip: Pick<TripRecord, 'cargoType' | 'items'>): CargoType[] {
  if (trip.items.length === 0) return trip.cargoType ? [trip.cargoType] : []
  const types = [...new Set(trip.items.map((item) => item.cargoType))]
  return [
    ...types.filter((type) => type === trip.cargoType),
    ...types.filter((type) => type !== trip.cargoType)
  ]
}

// The company's trips list: search, filters, sort and group, paged by the API
export const TRIP_SORTS = [
  'departureAt',
  'createdAt',
  'amount',
  'tripCost',
  'distance',
  'status'
] as const
export type TripSort = (typeof TRIP_SORTS)[number]
export const TRIP_GROUPS = [
  'status',
  'month',
  'vehicle',
  'driver',
  'route',
  'tripKind',
  'cargoType',
  'branch',
  'category'
] as const
export type TripGroup = (typeof TRIP_GROUPS)[number]
// "billed" also matches the legacy "paid" status
export const TRIP_STATUS_FILTERS = ['draft', 'billed', 'certified', 'revoked', 'cancelled'] as const

// The longest period the trips list shows at once (about a quarter)
export const MAX_PERIOD_DAYS = 92

// A month as the trips list's period: its first and last day, YYYY-MM-DD (local, Sudan time)
export function monthPeriod(year: number, month: number): { from: string; to: string } {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const last = new Date(year, month + 1, 0).getDate()
  const y = new Date(year, month, 1)
  const prefix = `${y.getFullYear()}-${pad(y.getMonth() + 1)}`
  return { from: `${prefix}-01`, to: `${prefix}-${pad(last)}` }
}

export interface TripListQuery {
  page: number
  pageSize: PageSize
  query?: string
  status?: (typeof TRIP_STATUS_FILTERS)[number]
  category?: TripCategory
  tripKind?: TripKind
  cargoType?: CargoType
  vehicleId?: number
  driverId?: number
  branchId?: number
  // The period shown (by departure), YYYY-MM-DD, both days included; the current month when
  // missing. Counts, groups, filters and the search all cover this period only.
  from?: string
  to?: string
  sort: TripSort
  direction: 'asc' | 'desc'
  group?: TripGroup
  // Route groups are ordered by city name in this language
  lang?: 'en' | 'ar'
}
