import { sql } from 'drizzle-orm'
import {
  pgTable,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  index,
  check,
  uniqueIndex
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
import { FEE_CODES, LINE_CODES, MAX_FEE, TAX_CODES } from '@masarat/shared/tax'

// Enum values live in src/shared so the renderer can use them too
export const USER_ROLES = ['owner', 'govt'] as const
export {
  VEHICLE_TYPES,
  QUANTITY_UNITS,
  CARGO_TYPES,
  ITEM_UNITS,
  MANIFEST_STATUSES,
  PAYMENT_STATUSES,
  TRIP_KINDS,
  TAX_CODES,
  FEE_CODES,
  LINE_CODES
}

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

export const users = pgTable(
  'users',
  {
    id,
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull(),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    companyName: text('company_name'),
    // Fleet owners' carrier details, printed on their manifests
    address: text('address'),
    tin: text('tin'),
    // Seeded demo accounts (see services/demoData.ts); "Regenerate demo data" only touches these
    isDemo: boolean('is_demo').notNull().default(false),
    // Government admins manage the government accounts (Users section)
    isAdmin: boolean('is_admin').notNull().default(false),
    // A disabled account can't log in and has no sessions; its records stay
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    // Set when an admin creates the account or resets its password
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    ...timestamps
  },
  (t) => [
    check('users_role_check', sql`${t.role} IN (${inList(USER_ROLES)})`),
    check('users_admin_check', sql`NOT ${t.isAdmin} OR ${t.role} = 'govt'`)
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

// A fleet owner's drivers, picked on each trip (the manifest keeps a copy of the name and phone)
export const drivers = pgTable(
  'drivers',
  {
    id,
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    ...timestamps
  },
  (t) => [uniqueIndex('drivers_owner_phone_idx').on(t.ownerId, t.phone)]
)

// Seeded by drizzle/0001_reference_data.sql
export const cities = pgTable('cities', {
  id,
  name: text('name').notNull().unique(),
  // Arabic display name; the UI falls back to `name` when it's missing
  nameAr: text('name_ar'),
  state: text('state').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  ...timestamps
})

export const vehicles = pgTable(
  'vehicles',
  {
    id,
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    plateNumber: text('plate_number').notNull().unique(),
    // رقم الترخيص. Required by the UI and services; null only for vehicles added before it existed
    registrationNo: text('registration_no'),
    vehicleType: text('vehicle_type', { enum: VEHICLE_TYPES }).notNull(),
    capacity: doublePrecision('capacity').notNull(),
    capacityUnit: text('capacity_unit', { enum: QUANTITY_UNITS }).notNull(),
    ...timestamps
  },
  (t) => [
    index('vehicles_owner_id_idx').on(t.ownerId),
    check('vehicles_type_check', sql`${t.vehicleType} IN (${inList(VEHICLE_TYPES)})`),
    check('vehicles_unit_check', sql`${t.capacityUnit} IN (${inList(QUANTITY_UNITS)})`),
    check('vehicles_capacity_check', sql`${t.capacity} > 0`)
  ]
)

// Trip cost rates: cost = ratePerKm * distanceKm * (quantity / perQuantity)
// e.g. 2000 SDG per km per 1 ton, or per 1000 liters. The taxes are percentages of that cost.
export const taxRates = pgTable(
  'tax_rates',
  {
    id,
    cargoType: text('cargo_type', { enum: CARGO_TYPES }).notNull().unique(),
    ratePerKm: integer('rate_per_km').notNull(),
    unit: text('unit', { enum: QUANTITY_UNITS }).notNull(),
    perQuantity: integer('per_quantity').notNull(),
    ...timestamps
  },
  (t) => [
    check('tax_rates_cargo_type_check', sql`${t.cargoType} IN (${inList(CARGO_TYPES)})`),
    check('tax_rates_unit_check', sql`${t.unit} IN (${inList(QUANTITY_UNITS)})`)
  ]
)

// The owner is derived via vehicle_id -> vehicles.owner_id
export const manifests = pgTable(
  'manifests',
  {
    id,
    vehicleId: integer('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    originCityId: integer('origin_city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    destinationCityId: integer('destination_city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    // The main cargo type (the item type with the largest cost) and its rate; each item keeps its own
    cargoType: text('cargo_type', { enum: CARGO_TYPES }).notNull(),
    // Total of the cargo items, in the vehicle's unit
    cargoQuantity: doublePrecision('cargo_quantity').notNull(),
    cargoUnit: text('cargo_unit', { enum: QUANTITY_UNITS }).notNull(),
    tripDate: timestamp('trip_date', { withTimezone: true }).notNull(),
    // Snapshot of the calculation, so later rate changes don't rewrite history
    distanceKm: doublePrecision('distance_km').notNull(),
    ratePerKm: integer('rate_per_km').notNull(),
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
    // The owner's carrier details, copied when the bill is generated
    carrierName: text('carrier_name'),
    carrierAddress: text('carrier_address'),
    carrierTin: text('carrier_tin'),
    ...timestamps
  },
  (t) => [
    index('manifests_vehicle_id_idx').on(t.vehicleId),
    check('manifests_trip_kind_check', sql`${t.tripKind} IN (${inList(TRIP_KINDS)})`),
    index('manifests_status_idx').on(t.status),
    check('manifests_route_check', sql`${t.originCityId} <> ${t.destinationCityId}`),
    check('manifests_cargo_type_check', sql`${t.cargoType} IN (${inList(CARGO_TYPES)})`),
    check('manifests_unit_check', sql`${t.cargoUnit} IN (${inList(QUANTITY_UNITS)})`),
    check('manifests_status_check', sql`${t.status} IN (${inList(MANIFEST_STATUSES)})`),
    check('manifests_quantity_check', sql`${t.cargoQuantity} > 0`)
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

// Current tax percentages, in basis points (1700 = 17%), and fixed fees, in whole SDG. A tax row
// has rate_bps, a fee row has amount. Editable by government users.
export const taxSettings = pgTable(
  'tax_settings',
  {
    id,
    code: text('code', { enum: LINE_CODES }).notNull().unique(),
    rateBps: integer('rate_bps'),
    amount: integer('amount'),
    ...timestamps
  },
  (t) => [
    check('tax_settings_code_check', sql`${t.code} IN (${inList(LINE_CODES)})`),
    check(
      'tax_settings_value_check',
      sql`(${t.code} IN (${inList(TAX_CODES)}) AND ${t.rateBps} BETWEEN 0 AND 10000 AND ${t.amount} IS NULL)
        OR (${t.code} IN (${inList(FEE_CODES)}) AND ${t.amount} BETWEEN 0 AND ${sql.raw(String(MAX_FEE))} AND ${t.rateBps} IS NULL)`
    )
  ]
)

// Audit log of tax percentage and fee changes. Values are basis points for a tax, SDG for a fee.
export const taxSettingChanges = pgTable('tax_setting_changes', {
  id,
  code: text('code', { enum: LINE_CODES }).notNull(),
  oldValue: integer('old_value').notNull(),
  newValue: integer('new_value').notNull(),
  changedBy: integer('changed_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow()
})

// The taxes and fees applied to a manifest, frozen when its bill is issued. rate_bps is null for
// a fee.
export const manifestTaxes = pgTable(
  'manifest_taxes',
  {
    id,
    manifestId: integer('manifest_id')
      .notNull()
      .references(() => manifests.id, { onDelete: 'restrict' }),
    code: text('code', { enum: LINE_CODES }).notNull(),
    rateBps: integer('rate_bps'),
    amount: integer('amount').notNull(),
    ...timestamps
  },
  (t) => [
    uniqueIndex('manifest_taxes_manifest_code_idx').on(t.manifestId, t.code),
    check('manifest_taxes_code_check', sql`${t.code} IN (${inList(LINE_CODES)})`)
  ]
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
    check('payments_status_check', sql`${t.status} IN (${inList(PAYMENT_STATUSES)})`),
    check('payments_amount_check', sql`${t.amount} > 0`)
  ]
)

// Issued once a manifest's bill is paid: the payment receipt and the authorized manifest
// (تصريح الحركة)
export const certificates = pgTable('certificates', {
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
})

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

export type User = typeof users.$inferSelect
export type Session = typeof sessions.$inferSelect
export type NewUser = typeof users.$inferInsert
export type City = typeof cities.$inferSelect
export type Vehicle = typeof vehicles.$inferSelect
export type NewVehicle = typeof vehicles.$inferInsert
export type Driver = typeof drivers.$inferSelect
export type TripDocument = typeof tripDocuments.$inferSelect
export type TaxRate = typeof taxRates.$inferSelect
export type Manifest = typeof manifests.$inferSelect
export type ManifestCargoItem = typeof manifestCargoItems.$inferSelect
export type ManifestTax = typeof manifestTaxes.$inferSelect
export type NewManifest = typeof manifests.$inferInsert
export type Payment = typeof payments.$inferSelect
export type NewPayment = typeof payments.$inferInsert
export type Certificate = typeof certificates.$inferSelect
export type NewCertificate = typeof certificates.$inferInsert
