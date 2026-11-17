import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, real, index, check } from 'drizzle-orm/sqlite-core'
import {
  VEHICLE_TYPES,
  QUANTITY_UNITS,
  CARGO_TYPES,
  MANIFEST_STATUSES,
  PAYMENT_STATUSES
} from '../../shared/fleet'

// Enum values live in src/shared so the renderer can use them too
export const USER_ROLES = ['owner', 'govt'] as const
export { VEHICLE_TYPES, QUANTITY_UNITS, CARGO_TYPES, MANIFEST_STATUSES, PAYMENT_STATUSES }

// SQLite does not enforce text enums, so each one is backed by a CHECK constraint
const inList = (values: readonly string[]): ReturnType<typeof sql.raw> =>
  sql.raw(values.map((v) => `'${v}'`).join(', '))

// Shared columns
const id = integer('id').primaryKey({ autoIncrement: true })
const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdate(() => new Date())
}

export const users = sqliteTable(
  'users',
  {
    id,
    username: text('username').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull(),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    companyName: text('company_name'),
    // Seeded demo accounts (see services/demoData.ts); "Regenerate demo data" only touches these
    isDemo: integer('is_demo', { mode: 'boolean' }).notNull().default(false),
    ...timestamps
  },
  (t) => [check('users_role_check', sql`${t.role} IN (${inList(USER_ROLES)})`)]
)

// Seeded from src/main/sd.csv (see drizzle/0001_seed_reference_data.sql)
export const cities = sqliteTable('cities', {
  id,
  name: text('name').notNull().unique(),
  // Arabic display name; the UI falls back to `name` when it's missing
  nameAr: text('name_ar'),
  state: text('state').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  ...timestamps
})

export const vehicles = sqliteTable(
  'vehicles',
  {
    id,
    ownerId: integer('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    plateNumber: text('plate_number').notNull().unique(),
    vehicleType: text('vehicle_type', { enum: VEHICLE_TYPES }).notNull(),
    capacity: real('capacity').notNull(),
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

// tax = ratePerKm * distanceKm * (quantity / perQuantity)
// e.g. 2000 SDG per km per 1 ton, or per 1000 liters
export const taxRates = sqliteTable(
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
export const manifests = sqliteTable(
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
    cargoType: text('cargo_type', { enum: CARGO_TYPES }).notNull(),
    cargoQuantity: real('cargo_quantity').notNull(),
    cargoUnit: text('cargo_unit', { enum: QUANTITY_UNITS }).notNull(),
    tripDate: integer('trip_date', { mode: 'timestamp' }).notNull(),
    // Snapshot of the calculation, so later rate changes don't rewrite history
    distanceKm: real('distance_km').notNull(),
    ratePerKm: integer('rate_per_km').notNull(),
    taxAmount: integer('tax_amount').notNull(),
    status: text('status', { enum: MANIFEST_STATUSES }).notNull().default('draft'),
    ...timestamps
  },
  (t) => [
    index('manifests_vehicle_id_idx').on(t.vehicleId),
    index('manifests_status_idx').on(t.status),
    check('manifests_route_check', sql`${t.originCityId} <> ${t.destinationCityId}`),
    check('manifests_cargo_type_check', sql`${t.cargoType} IN (${inList(CARGO_TYPES)})`),
    check('manifests_unit_check', sql`${t.cargoUnit} IN (${inList(QUANTITY_UNITS)})`),
    check('manifests_status_check', sql`${t.status} IN (${inList(MANIFEST_STATUSES)})`),
    check('manifests_quantity_check', sql`${t.cargoQuantity} > 0`)
  ]
)

// One bill per manifest for the MVP. Amounts are whole SDG.
export const payments = sqliteTable(
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
    paidAt: integer('paid_at', { mode: 'timestamp' }),
    ...timestamps
  },
  (t) => [
    check('payments_status_check', sql`${t.status} IN (${inList(PAYMENT_STATUSES)})`),
    check('payments_amount_check', sql`${t.amount} > 0`)
  ]
)

export const certificates = sqliteTable('certificates', {
  id,
  manifestId: integer('manifest_id')
    .notNull()
    .unique()
    .references(() => manifests.id, { onDelete: 'restrict' }),
  certificateNo: text('certificate_no').notNull().unique(),
  // Random, unguessable value encoded in the QR; looked up by the public verify screen
  qrToken: text('qr_token').notNull().unique(),
  issuedAt: integer('issued_at', { mode: 'timestamp' })
    .notNull()
    .default(sql`(unixepoch())`),
  validUntil: integer('valid_until', { mode: 'timestamp' }).notNull(),
  ...timestamps
})

// SIMULATION ONLY: stands in for E-Sali's own records of the bills it issued, so a simulated
// payment survives restarts and only reaches `payments` when the app checks the bill's status.
// Drop this table once the real E-Sali API is integrated.
export const esaliSimBills = sqliteTable(
  'esali_sim_bills',
  {
    id,
    billId: text('bill_id').notNull().unique(),
    amount: integer('amount').notNull(),
    status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('pending'),
    paymentRef: text('payment_ref').unique(),
    paidAt: integer('paid_at', { mode: 'timestamp' }),
    ...timestamps
  },
  (t) => [check('esali_sim_bills_status_check', sql`${t.status} IN (${inList(PAYMENT_STATUSES)})`)]
)

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type City = typeof cities.$inferSelect
export type Vehicle = typeof vehicles.$inferSelect
export type NewVehicle = typeof vehicles.$inferInsert
export type TaxRate = typeof taxRates.$inferSelect
export type Manifest = typeof manifests.$inferSelect
export type NewManifest = typeof manifests.$inferInsert
export type Payment = typeof payments.$inferSelect
export type NewPayment = typeof payments.$inferInsert
export type Certificate = typeof certificates.$inferSelect
export type NewCertificate = typeof certificates.$inferInsert
