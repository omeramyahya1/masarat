import { sql } from 'drizzle-orm'
import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  date,
  timestamp,
  index,
  check,
  primaryKey,
  unique,
  uniqueIndex,
  type AnyPgColumn
} from 'drizzle-orm/pg-core'
import {
  VEHICLE_TYPES,
  QUANTITY_UNITS,
  CARGO_TYPES,
  ITEM_UNITS,
  MANIFEST_STATUSES,
  PAYMENT_STATUSES,
  TRIP_KINDS,
  DOCUMENT_TYPES
} from '@masarat/shared/fleet'
import {
  CHARGE_FIELDS,
  CHARGE_KINDS,
  MAX_FEE,
  MAX_TAX_BPS,
  PRICING_CODES,
  RATE_UNITS,
  TRIP_CATEGORIES
} from '@masarat/shared/tax'
import { ID_TYPES } from '@masarat/shared/passengers'
import {
  BUILTIN_ROLE_KEYS,
  PERMISSIONS,
  ROLE_SCOPES,
  USER_KINDS
} from '@masarat/shared/permissions'

// Enum values live in packages/shared so the portals can use them too
export {
  VEHICLE_TYPES,
  QUANTITY_UNITS,
  CARGO_TYPES,
  ITEM_UNITS,
  MANIFEST_STATUSES,
  PAYMENT_STATUSES,
  TRIP_KINDS
}

// What the daily revenue summary is kept by (services/dailyRevenue.ts)
export const REVENUE_DIMENSIONS = [
  'total',
  'category',
  'cargo',
  'charge',
  'route',
  'origin_state',
  'destination_state',
  'company',
  'vehicle_type',
  'trip_kind'
] as const
export type RevenueDimension = (typeof REVENUE_DIMENSIONS)[number]

// Text enums are backed by a CHECK constraint each, so adding a value is a plain migration
const inList = (values: readonly string[]): ReturnType<typeof sql.raw> =>
  sql.raw(values.map((v) => `'${v}'`).join(', '))

// Shared columns
const id = integer('id').primaryKey().generatedAlwaysAsIdentity()
const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
}

// Sudan's states, and the cities trips run between. Seeded by drizzle/0001_reference_data.sql.
export const states = pgTable('states', {
  id,
  name: text('name').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  // Set once the state's cities exist (the seed inserts the states first)
  capitalCityId: integer('capital_city_id').references((): AnyPgColumn => cities.id, {
    onDelete: 'restrict'
  }),
  ...timestamps
})

export const cities = pgTable(
  'cities',
  {
    id,
    name: text('name').notNull().unique(),
    nameAr: text('name_ar').notNull(),
    stateId: integer('state_id')
      .notNull()
      .references(() => states.id, { onDelete: 'restrict' }),
    lat: doublePrecision('lat').notNull(),
    lng: doublePrecision('lng').notNull(),
    ...timestamps
  },
  (t) => [index('cities_state_id_idx').on(t.stateId)]
)

// A transport company (شركة النقل). Its name, address and TIN are printed on its manifests as the
// carrier. Vehicles and drivers belong to the company; trips are booked at one of its branches.
export const companies = pgTable('companies', {
  id,
  name: text('name').notNull(),
  address: text('address'),
  tin: text('tin'),
  // Seeded demo companies (see services/demoData.ts); "Regenerate demo data" only touches these
  isDemo: boolean('is_demo').notNull().default(false),
  ...timestamps
})

// Where a company sells tickets and books cargo: often a booth at a land port
export const branches = pgTable(
  'branches',
  {
    id,
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    cityId: integer('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    // A closed branch keeps its trips and members but takes no new trips
    active: boolean('active').notNull().default(true),
    ...timestamps
  },
  (t) => [uniqueIndex('branches_company_name_idx').on(t.companyId, t.name)]
)

// A set of permissions (packages/shared/src/permissions.ts). Government roles have no company. The
// built-in ones have a key; a locked built-in role's permissions come from the code, not
// role_permissions.
export const roles = pgTable(
  'roles',
  {
    id,
    companyId: integer('company_id').references(() => companies.id, { onDelete: 'restrict' }),
    key: text('key', { enum: BUILTIN_ROLE_KEYS }),
    name: text('name').notNull(),
    scope: text('scope', { enum: ROLE_SCOPES }).notNull(),
    ...timestamps
  },
  (t) => [
    check('roles_key_check', sql`${t.key} IS NULL OR ${t.key} IN (${inList(BUILTIN_ROLE_KEYS)})`),
    check('roles_scope_check', sql`${t.scope} IN (${inList(ROLE_SCOPES)})`),
    // The government's roles are fixed: only companies make their own
    check('roles_govt_check', sql`${t.companyId} IS NOT NULL OR ${t.key} IS NOT NULL`),
    // NULLS NOT DISTINCT: the government's roles (no company) are unique too
    unique('roles_company_name_unique').on(t.companyId, t.name).nullsNotDistinct(),
    // One of each built-in role per company (and one for the government, company 0 here)
    uniqueIndex('roles_company_key_idx')
      .on(sql`coalesce(${t.companyId}, 0)`, t.key)
      .where(sql`${t.key} IS NOT NULL`)
  ]
)

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: text('permission', { enum: PERMISSIONS }).notNull()
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permission] }),
    check('role_permissions_permission_check', sql`${t.permission} IN (${inList(PERMISSIONS)})`)
  ]
)

// Everyone who signs in: a company's members and the government's staff
export const users = pgTable(
  'users',
  {
    id,
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    kind: text('kind', { enum: USER_KINDS }).notNull(),
    fullName: text('full_name').notNull(),
    // A Sudanese mobile number, "+249…" (normalizeSudanPhone), one account per number
    phone: text('phone').notNull().unique(),
    // A company member's company; null for the government
    companyId: integer('company_id').references(() => companies.id, { onDelete: 'restrict' }),
    roleId: integer('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    // The member's branch, when their role is branch-scoped (checked by services/members.ts)
    branchId: integer('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    // Seeded demo accounts (see services/demoData.ts)
    isDemo: boolean('is_demo').notNull().default(false),
    // A disabled account can't log in and has no sessions; its records stay
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    // Set when an admin creates the account or resets its password
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    ...timestamps
  },
  (t) => [
    index('users_company_id_idx').on(t.companyId),
    check('users_kind_check', sql`${t.kind} IN (${inList(USER_KINDS)})`),
    check(
      'users_company_check',
      sql`(${t.kind} = 'company') = (${t.companyId} IS NOT NULL) AND (${t.kind} = 'company' OR ${t.branchId} IS NULL)`
    )
  ]
)

// Signed-in browsers. The cookie holds a random token; only its SHA-256 is stored, so a leaked
// table can't be used to sign in. Ends after IDLE or ABSOLUTE time (services/sessions.ts).
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ip: text('ip'),
    userAgent: text('user_agent')
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)]
)

// Login attempts, for slowing down password guessing (per username and per IP). Kept a day.
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id,
    username: text('username').notNull(),
    ip: text('ip'),
    succeeded: boolean('succeeded').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index('login_attempts_username_at_idx').on(t.username, t.at),
    index('login_attempts_ip_at_idx').on(t.ip, t.at)
  ]
)

// A company's drivers, picked on each trip (the manifest keeps a copy of the name and phone)
export const drivers = pgTable(
  'drivers',
  {
    id,
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    ...timestamps
  },
  (t) => [uniqueIndex('drivers_company_phone_idx').on(t.companyId, t.phone)]
)

export const vehicles = pgTable(
  'vehicles',
  {
    id,
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    plateNumber: text('plate_number').notNull().unique(),
    // رقم الترخيص. Required by the UI and services; null only for vehicles added before it existed
    registrationNo: text('registration_no'),
    vehicleType: text('vehicle_type', { enum: VEHICLE_TYPES }).notNull(),
    capacity: doublePrecision('capacity').notNull(),
    capacityUnit: text('capacity_unit', { enum: QUANTITY_UNITS }).notNull(),
    ...timestamps
  },
  (t) => [
    index('vehicles_company_id_idx').on(t.companyId),
    // Substring search on registration numbers and plates (the plate as plateKeyOf compares it)
    index('vehicles_registration_no_trgm_idx').using('gin', t.registrationNo.op('gin_trgm_ops')),
    index('vehicles_plate_key_trgm_idx').using(
      'gin',
      sql`(replace(replace(upper(${t.plateNumber}), ' ', ''), '/', '')) gin_trgm_ops`
    ),
    check('vehicles_type_check', sql`${t.vehicleType} IN (${inList(VEHICLE_TYPES)})`),
    check('vehicles_unit_check', sql`${t.capacityUnit} IN (${inList(QUANTITY_UNITS)})`),
    check('vehicles_capacity_check', sql`${t.capacity} > 0`),
    // A bus is counted in seats, and only a bus
    check('vehicles_bus_seat_check', sql`(${t.vehicleType} = 'bus') = (${t.capacityUnit} = 'seat')`)
  ]
)

// The development pricing formula's rates (services/pricing.ts): per km for each cargo type (per
// `per_quantity` of its unit), and per km per seat for a passenger ticket
export const pricingRates = pgTable(
  'pricing_rates',
  {
    id,
    code: text('code', { enum: PRICING_CODES }).notNull().unique(),
    ratePerKm: integer('rate_per_km').notNull(),
    unit: text('unit', { enum: RATE_UNITS }).notNull(),
    perQuantity: integer('per_quantity').notNull(),
    ...timestamps
  },
  (t) => [
    check('pricing_rates_code_check', sql`${t.code} IN (${inList(PRICING_CODES)})`),
    check('pricing_rates_unit_check', sql`${t.unit} IN (${inList(RATE_UNITS)})`),
    check('pricing_rates_rate_check', sql`${t.ratePerKm} >= 0 AND ${t.perQuantity} > 0`)
  ]
)

// The taxes and fees (packages/shared/src/tax.ts): a percentage in basis points or a fixed amount
// in SDG, with a value per kind of trip (null: not charged on it). Managed by the government admin.
export const charges = pgTable(
  'charges',
  {
    id,
    // The built-in ones' codes, or custom_<id>
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    nameAr: text('name_ar').notNull(),
    kind: text('kind', { enum: CHARGE_KINDS }).notNull(),
    cargoValue: integer('cargo_value'),
    passengerValue: integer('passenger_value'),
    active: boolean('active').notNull().default(true),
    builtin: boolean('builtin').notNull().default(false),
    // Display and billing order within its kind
    sort: integer('sort').notNull().default(0),
    ...timestamps
  },
  (t) => [
    check('charges_kind_check', sql`${t.kind} IN (${inList(CHARGE_KINDS)})`),
    check(
      'charges_value_check',
      sql`(${t.kind} = 'percent' AND coalesce(${t.cargoValue}, 0) BETWEEN 0 AND ${sql.raw(String(MAX_TAX_BPS))} AND coalesce(${t.passengerValue}, 0) BETWEEN 0 AND ${sql.raw(String(MAX_TAX_BPS))})
        OR (${t.kind} = 'fixed' AND coalesce(${t.cargoValue}, 0) BETWEEN 0 AND ${sql.raw(String(MAX_FEE))} AND coalesce(${t.passengerValue}, 0) BETWEEN 0 AND ${sql.raw(String(MAX_FEE))})`
    )
  ]
)

// Audit log of the changes to the taxes and fees: who changed which field, from what to what
// (as text, see ChargeChange)
export const chargeChanges = pgTable(
  'charge_changes',
  {
    id,
    chargeId: integer('charge_id')
      .notNull()
      .references(() => charges.id, { onDelete: 'restrict' }),
    field: text('field', { enum: CHARGE_FIELDS }).notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    changedBy: integer('changed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [check('charge_changes_field_check', sql`${t.field} IN (${inList(CHARGE_FIELDS)})`)]
)

// The company is derived via vehicle_id -> vehicles.company_id
export const manifests = pgTable(
  'manifests',
  {
    id,
    vehicleId: integer('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    // The vehicle's company, kept on the trip so company-scoped lists and counts read one index
    // (services/access.ts tripScopeCondition) instead of joining vehicles
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    // The company branch the trip was booked at, and who booked it
    branchId: integer('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    originCityId: integer('origin_city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    destinationCityId: integer('destination_city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    // cargo, or passenger (a bus), from the vehicle
    category: text('category', { enum: TRIP_CATEGORIES }).notNull().default('cargo'),
    // A cargo trip's main type (the item type with the largest cost) and its rate; each item keeps
    // its own. Null for a passenger trip.
    cargoType: text('cargo_type', { enum: CARGO_TYPES }),
    // Cargo: the items' total in the vehicle's unit. Passengers: the tickets (seats sold), in seats.
    cargoQuantity: doublePrecision('cargo_quantity').notNull(),
    cargoUnit: text('cargo_unit', { enum: QUANTITY_UNITS }).notNull(),
    // When it leaves, and when it's expected to arrive (the documents' validity follows it)
    departureAt: timestamp('departure_at', { withTimezone: true }).notNull(),
    arrivalAt: timestamp('arrival_at', { withTimezone: true }).notNull(),
    // Snapshot of the calculation, so later rate changes don't rewrite history
    distanceKm: doublePrecision('distance_km').notNull(),
    // Cargo: the main type's rate. Passengers: the ticket rate per km.
    ratePerKm: integer('rate_per_km').notNull(),
    // A passenger trip's ticket price (rate × distance); null for cargo
    ticketPrice: integer('ticket_price'),
    tripCost: integer('trip_cost').notNull(),
    // Sum of the trip's manifest_taxes lines: the amount billed
    taxAmount: integer('tax_amount').notNull(),
    status: text('status', { enum: MANIFEST_STATUSES }).notNull().default('draft'),
    tripKind: text('trip_kind', { enum: TRIP_KINDS }).notNull().default('domestic'),
    // The driver picked for the trip, and a copy of their name and phone: the copy is what the
    // manifest prints, so editing or deleting the driver later doesn't change it
    driverId: integer('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
    driverName: text('driver_name'),
    driverPhone: text('driver_phone'),
    // Sender (shipper) and receiver. Drafts may leave them empty; a bill needs all of them.
    shipperName: text('shipper_name'),
    shipperAddress: text('shipper_address'),
    shipperPhone: text('shipper_phone'),
    receiverName: text('receiver_name'),
    receiverAddress: text('receiver_address'),
    receiverPhone: text('receiver_phone'),
    // The company's carrier details, copied when the bill is generated
    carrierName: text('carrier_name'),
    carrierAddress: text('carrier_address'),
    carrierTin: text('carrier_tin'),
    ...timestamps
  },
  (t) => [
    index('manifests_vehicle_id_idx').on(t.vehicleId),
    // A company's or a branch's trips, newest first: the trips list, its counts and suggestions
    index('manifests_company_departure_idx').on(t.companyId, t.departureAt),
    index('manifests_branch_departure_idx').on(t.branchId, t.departureAt),
    // Trips from or to a city, newest first: the government search by city name or route
    index('manifests_origin_departure_idx').on(t.originCityId, t.departureAt),
    index('manifests_destination_departure_idx').on(t.destinationCityId, t.departureAt),
    index('manifests_driver_id_idx').on(t.driverId),
    // Trips by status in a period (the dashboard), answered from the index alone
    index('manifests_created_status_idx').on(t.createdAt, t.status),
    // Substring search on names (pg_trgm, created by the migration)
    index('manifests_shipper_name_trgm_idx').using('gin', t.shipperName.op('gin_trgm_ops')),
    index('manifests_receiver_name_trgm_idx').using('gin', t.receiverName.op('gin_trgm_ops')),
    index('manifests_driver_name_trgm_idx').using('gin', t.driverName.op('gin_trgm_ops')),
    check('manifests_trip_kind_check', sql`${t.tripKind} IN (${inList(TRIP_KINDS)})`),
    index('manifests_status_idx').on(t.status),
    check('manifests_route_check', sql`${t.originCityId} <> ${t.destinationCityId}`),
    index('manifests_departure_at_idx').on(t.departureAt),
    check('manifests_category_check', sql`${t.category} IN (${inList(TRIP_CATEGORIES)})`),
    check(
      'manifests_cargo_type_check',
      sql`${t.category} = 'cargo' AND ${t.cargoType} IN (${inList(CARGO_TYPES)})
        OR ${t.category} = 'passenger' AND ${t.cargoType} IS NULL AND ${t.cargoUnit} = 'seat'`
    ),
    check('manifests_unit_check', sql`${t.cargoUnit} IN (${inList(QUANTITY_UNITS)})`),
    check('manifests_status_check', sql`${t.status} IN (${inList(MANIFEST_STATUSES)})`),
    // A passenger draft may have no passengers yet
    check(
      'manifests_quantity_check',
      sql`${t.cargoQuantity} > 0 OR ${t.category} = 'passenger' AND ${t.cargoQuantity} >= 0`
    ),
    check('manifests_arrival_check', sql`${t.arrivalAt} > ${t.departureAt}`)
  ]
)

// What a manifest carries; quantities in the item's own unit (converted for the capacity check).
// Each item has its own cargo type, priced at its rate; the trip cost is the sum of the costs.
export const manifestCargoItems = pgTable(
  'manifest_cargo_items',
  {
    id,
    manifestId: integer('manifest_id')
      .notNull()
      .references(() => manifests.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    // The weight (or volume): drives the trip cost and the capacity check
    quantity: doublePrecision('quantity').notNull(),
    unit: text('unit', { enum: ITEM_UNITS }).notNull(),
    cargoType: text('cargo_type', { enum: CARGO_TYPES }).notNull(),
    // Snapshot of the rate and the resulting cost, like the manifest's
    ratePerKm: integer('rate_per_km').notNull(),
    perQuantity: integer('per_quantity').notNull(),
    cost: integer('cost').notNull(),
    // How it's packed (براميل، شوال، …), how many packages, and free notes. Drafts may leave the
    // packing and count empty; a bill needs them.
    packingType: text('packing_type'),
    packageCount: integer('package_count'),
    notes: text('notes'),
    ...timestamps
  },
  (t) => [
    index('manifest_cargo_items_manifest_id_idx').on(t.manifestId),
    check('manifest_cargo_items_cargo_type_check', sql`${t.cargoType} IN (${inList(CARGO_TYPES)})`),
    check('manifest_cargo_items_unit_check', sql`${t.unit} IN (${inList(ITEM_UNITS)})`),
    check(
      'manifest_cargo_items_package_count_check',
      sql`${t.packageCount} IS NULL OR ${t.packageCount} > 0`
    ),
    check('manifest_cargo_items_quantity_check', sql`${t.quantity} > 0`)
  ]
)

// Trailer plates pulled by the vehicle on a trip, in order
export const manifestTrailers = pgTable(
  'manifest_trailers',
  {
    id,
    manifestId: integer('manifest_id')
      .notNull()
      .references(() => manifests.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    plateNumber: text('plate_number').notNull(),
    ...timestamps
  },
  (t) => [index('manifest_trailers_manifest_id_idx').on(t.manifestId)]
)

// Everyone who has travelled with an ID, once (a registry shared by every company): a national ID
// or passport number, and the name they were last booked under. A trip's passenger links to the
// person and keeps the name as booked, since the passenger manifest is an official document.
export const people = pgTable(
  'people',
  {
    id,
    idType: text('id_type', { enum: ID_TYPES }).notNull(),
    // Normalized (packages/shared/src/passengers.ts normalizeIdNumber)
    idNumber: text('id_number').notNull(),
    fullName: text('full_name').notNull(),
    ...timestamps
  },
  (t) => [
    uniqueIndex('people_id_idx').on(t.idType, t.idNumber),
    // The government search by ID number, whatever its type
    index('people_id_number_idx').on(t.idNumber),
    check('people_id_type_check', sql`${t.idType} IN (${inList(ID_TYPES)})`)
  ]
)

// A passenger trip's passengers. Everyone with a seat has a ticket; an infant shares a passenger's
// seat. Their ID is the person's (people); the government search finds a person's trips through
// person_id with one lookup each.
export const tripPassengers = pgTable(
  'trip_passengers',
  {
    id,
    manifestId: integer('manifest_id')
      .notNull()
      .references(() => manifests.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    // The name as booked on this trip
    fullName: text('full_name').notNull(),
    // The person (their ID type and number), or null for an infant without an ID
    personId: integer('person_id').references(() => people.id, { onDelete: 'restrict' }),
    seatNo: integer('seat_no').notNull(),
    isInfant: boolean('is_infant').notNull().default(false),
    notes: text('notes'),
    ...timestamps
  },
  (t) => [
    index('trip_passengers_manifest_id_idx').on(t.manifestId),
    index('trip_passengers_person_id_idx').on(t.personId),
    // One ticket per seat
    uniqueIndex('trip_passengers_seat_idx')
      .on(t.manifestId, t.seatNo)
      .where(sql`NOT ${t.isInfant}`),
    check('trip_passengers_seat_check', sql`${t.seatNo} > 0`)
  ]
)

// A company's saved passenger trips (packages/shared/src/templates.ts)
export const tripTemplates = pgTable(
  'trip_templates',
  {
    id,
    companyId: integer('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'restrict' }),
    branchId: integer('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    originCityId: integer('origin_city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    destinationCityId: integer('destination_city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    vehicleId: integer('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    driverId: integer('driver_id').references(() => drivers.id, { onDelete: 'set null' }),
    // HH:MM, Sudan time
    departureTime: text('departure_time').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    ...timestamps
  },
  (t) => [
    index('trip_templates_company_id_idx').on(t.companyId),
    check('trip_templates_route_check', sql`${t.originCityId} <> ${t.destinationCityId}`),
    check('trip_templates_duration_check', sql`${t.durationMinutes} > 0`)
  ]
)

// The government's settings (packages/shared/src/settings.ts), one row per value
export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  value: integer('value').notNull(),
  ...timestamps
})

// Supporting documents attached to a trip (invoice, packing list, …). The files live in the app's
// data folder under documents/<manifest id>/<stored name>.
export const tripDocuments = pgTable(
  'trip_documents',
  {
    id,
    manifestId: integer('manifest_id')
      .notNull()
      .references(() => manifests.id, { onDelete: 'restrict' }),
    docType: text('doc_type', { enum: DOCUMENT_TYPES }).notNull(),
    // The name the owner's file had, shown in the app
    fileName: text('file_name').notNull(),
    storedName: text('stored_name').notNull(),
    size: integer('size').notNull(),
    ...timestamps
  },
  (t) => [
    uniqueIndex('trip_documents_manifest_type_idx').on(t.manifestId, t.docType),
    check('trip_documents_type_check', sql`${t.docType} IN (${inList(DOCUMENT_TYPES)})`)
  ]
)

// A manifest's bill lines, frozen when its bill is issued (drafts are repriced): each charge's
// code, name and value then. rate_bps is null for a fixed fee.
export const manifestCharges = pgTable(
  'manifest_charges',
  {
    id,
    manifestId: integer('manifest_id')
      .notNull()
      .references(() => manifests.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    nameAr: text('name_ar').notNull(),
    rateBps: integer('rate_bps'),
    amount: integer('amount').notNull(),
    ...timestamps
  },
  (t) => [uniqueIndex('manifest_charges_manifest_code_idx').on(t.manifestId, t.code)]
)

// One bill per manifest for the MVP. Amounts are whole SDG.
export const payments = pgTable(
  'payments',
  {
    id,
    manifestId: integer('manifest_id')
      .notNull()
      .unique()
      .references(() => manifests.id, { onDelete: 'restrict' }),
    billId: text('bill_id').notNull().unique(),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull().default('SDG'),
    status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('pending'),
    bank: text('bank'),
    paymentRef: text('payment_ref').unique(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    ...timestamps
  },
  (t) => [
    // Paid in a period (the dashboard, exports) and pending bills
    index('payments_status_paid_at_idx').on(t.status, t.paidAt),
    // Billed in a period (collection rate, exports)
    index('payments_created_at_idx').on(t.createdAt),
    // The collection rate (billed and paid in a period), answered from the index alone
    index('payments_created_status_amount_idx').on(t.createdAt, t.status, t.amount),
    // Pending bills
    index('payments_pending_idx')
      .on(t.manifestId, t.amount)
      .where(sql`${t.status} = 'pending'`),
    // Bill ID prefixes in the government search (LIKE '2026…%')
    index('payments_bill_id_pattern_idx').on(t.billId.op('text_pattern_ops')),
    check('payments_status_check', sql`${t.status} IN (${inList(PAYMENT_STATUSES)})`),
    check('payments_amount_check', sql`${t.amount} > 0`)
  ]
)

// Issued once a manifest's bill is paid: the payment receipt and the authorized manifest
// (تصريح الحركة)
export const certificates = pgTable(
  'certificates',
  {
    id,
    manifestId: integer('manifest_id')
      .notNull()
      .unique()
      .references(() => manifests.id, { onDelete: 'restrict' }),
    // The electronic payment receipt's number (MSR-yyyy-xxxxxx)
    certificateNo: text('certificate_no').notNull().unique(),
    // The authorized manifest's number (MNF-yyyy-xxxxxx), issued with the receipt
    manifestNo: text('manifest_no').notNull().unique(),
    // Random, unguessable value encoded in the QR; looked up by the public verify screen
    qrToken: text('qr_token').notNull().unique(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    ...timestamps
  },
  (t) => [
    // Issued in a period, and still valid (the dashboard)
    index('certificates_issued_at_idx').on(t.issuedAt),
    index('certificates_valid_until_idx').on(t.validUntil),
    // MNF- / PSG- / MSR- prefixes in the government search
    index('certificates_manifest_no_pattern_idx').on(t.manifestNo.op('text_pattern_ops')),
    index('certificates_certificate_no_pattern_idx').on(t.certificateNo.op('text_pattern_ops'))
  ]
)

// SIMULATION ONLY: stands in for E-Sali's own records of the bills it issued, so a simulated
// payment survives restarts and only reaches `payments` when the app checks the bill's status.
// Drop this table once the real E-Sali API is integrated.
export const esaliSimBills = pgTable(
  'esali_sim_bills',
  {
    id,
    billId: text('bill_id').notNull().unique(),
    amount: integer('amount').notNull(),
    status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('pending'),
    paymentRef: text('payment_ref').unique(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    ...timestamps
  },
  (t) => [check('esali_sim_bills_status_check', sql`${t.status} IN (${inList(PAYMENT_STATUSES)})`)]
)

// The dashboard's revenue per Sudan day, by dimension (services/dailyRevenue.ts): kept up to date
// in the transaction that records a payment as paid, so the unfiltered dashboard reads days
// instead of every paid trip. `key` is the group (a cargo type, a route "<origin>-<destination>",
// a company id, …; '' for the total); a charge's row carries the name of its latest bill line.
// A trip's taxes are split across its cargo items by cost, so `revenue` isn't whole.
export const dailyRevenue = pgTable(
  'daily_revenue',
  {
    day: date('day', { mode: 'string' }).notNull(),
    dimension: text('dimension', { enum: REVENUE_DIMENSIONS }).notNull(),
    key: text('key').notNull(),
    name: text('name'),
    nameAr: text('name_ar'),
    revenue: doublePrecision('revenue').notNull(),
    trips: integer('trips').notNull()
  },
  (t) => [
    primaryKey({ columns: [t.day, t.dimension, t.key] }),
    check('daily_revenue_dimension_check', sql`${t.dimension} IN (${inList(REVENUE_DIMENSIONS)})`)
  ]
)

export type User = typeof users.$inferSelect
export type Company = typeof companies.$inferSelect
export type Branch = typeof branches.$inferSelect
export type Role = typeof roles.$inferSelect
export type State = typeof states.$inferSelect
export type Session = typeof sessions.$inferSelect
export type NewUser = typeof users.$inferInsert
export type City = typeof cities.$inferSelect
export type Vehicle = typeof vehicles.$inferSelect
export type NewVehicle = typeof vehicles.$inferInsert
export type Driver = typeof drivers.$inferSelect
export type TripPassenger = typeof tripPassengers.$inferSelect
export type TripTemplate = typeof tripTemplates.$inferSelect
export type Charge = typeof charges.$inferSelect
export type TripDocument = typeof tripDocuments.$inferSelect
export type Manifest = typeof manifests.$inferSelect
export type ManifestCargoItem = typeof manifestCargoItems.$inferSelect
export type NewManifest = typeof manifests.$inferInsert
export type Payment = typeof payments.$inferSelect
export type NewPayment = typeof payments.$inferInsert
export type Certificate = typeof certificates.$inferSelect
export type NewCertificate = typeof certificates.$inferInsert
