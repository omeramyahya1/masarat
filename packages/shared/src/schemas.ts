// The shape of every request the API accepts (bodies and query strings), as zod schemas. The API
// checks each request against its schema before a service sees it (apps/api/src/http/validate.ts),
// and builds its OpenAPI document from them. They check types, required fields, allowed values and
// sizes; the domain rules (a valid plate, phone or ID number, a seat on the bus, what billing
// needs, …) stay in the services, which answer their own error codes.
//
// Each schema is checked against the TypeScript input type the portals already send (`Shape<T>`),
// so the two can't drift apart.
import { z } from 'zod'
import { BREAKDOWNS, BREAKDOWN_SORTS, BUCKET_SIZES, RANGE_PRESETS, parseDay } from './analytics'
import {
  CARGO_TYPES,
  DOCUMENT_TYPES,
  ITEM_UNITS,
  QUANTITY_UNITS,
  TRIP_GROUPS,
  TRIP_KINDS,
  TRIP_SORTS,
  TRIP_STATUS_FILTERS,
  VEHICLE_TYPES,
  type TripInput,
  type TripListQuery
} from './fleet'
import { DATE_BASES, EXPORT_DATASETS, EXPORT_FORMATS, EXPORT_STATUSES } from './exports'
import { ID_TYPES } from './passengers'
import { PAGE_SIZES, DEFAULT_PAGE_SIZE } from './paging'
import { COMPANY_PERMISSIONS, ROLE_SCOPES } from './permissions'
import {
  REPORT_REASONS,
  REPORT_STATUSES,
  type CancelTripInput,
  type DecisionInput,
  type DismissInput,
  type ReportInput,
  type ReportListQuery
} from './reviews'
import { CHARGE_KINDS, TRIP_CATEGORIES } from './tax'

// A schema whose parsed value is assignable to T
const shape =
  <T>() =>
  <S extends z.ZodType<T>>(schema: S): S =>
    schema

// Text fields: generous caps (the services apply the real limits and answer their own codes)
const text = (max = 200): z.ZodString => z.string().max(max)
const id = z.number().int().positive()
const nullableId = id.nullable()

// --- Auth -------------------------------------------------------------------------------------

export const logInSchema = z.object({ username: text(100), password: text(256) })

export const signUpSchema = z.object({
  fullName: text(),
  username: text(100),
  password: text(256),
  phone: text(40),
  companyName: text(),
  address: text(500).optional(),
  tin: text(60).optional()
})

export const changePasswordSchema = z.object({
  currentPassword: text(256),
  newPassword: text(256)
})

export const profileSchema = z.object({ fullName: text(), phone: text(40) })

// --- Company, branches, roles, members ---------------------------------------------------------

export const companySchema = z.object({ name: text(), address: text(500), tin: text(60) })

export const branchSchema = z.object({ name: text(), cityId: id, active: z.boolean().optional() })

export const roleSchema = z.object({
  name: text(),
  scope: z.enum(ROLE_SCOPES),
  permissions: z.array(z.enum(COMPANY_PERMISSIONS)).max(COMPANY_PERMISSIONS.length)
})

export const memberRoleSchema = z.object({ roleId: id, branchId: nullableId.optional() })

export const newMemberSchema = memberRoleSchema.extend({
  username: text(100),
  fullName: text(),
  phone: text(40)
})

// --- Vehicles, drivers, templates --------------------------------------------------------------

export const vehicleSchema = z.object({
  plateNumber: text(40),
  registrationNo: text(60),
  vehicleType: z.enum(VEHICLE_TYPES),
  capacity: z.number().nonnegative(),
  capacityUnit: z.enum(QUANTITY_UNITS)
})

export const driverSchema = z.object({ name: text(), phone: text(40) })

export const templateSchema = z.object({
  name: text(),
  branchId: id,
  originCityId: id,
  destinationCityId: id,
  vehicleId: id,
  driverId: nullableId,
  departureTime: text(10),
  durationMinutes: z.number().int().nonnegative()
})

// --- Trips -------------------------------------------------------------------------------------

const partySchema = z.object({ name: text(), address: text(500), phone: text(40) })

const cargoItemSchema = z.object({
  name: text(),
  quantity: z.number().nonnegative(),
  unit: z.enum(ITEM_UNITS),
  cargoType: z.enum(CARGO_TYPES),
  packingType: text(100).nullable(),
  packageCount: z.number().int().nonnegative().nullable(),
  notes: text(1000).nullable()
})

const passengerSchema = z.object({
  fullName: text(),
  idType: z.enum(ID_TYPES).nullable(),
  idNumber: text(40).nullable(),
  seatNo: z.number().int(),
  isInfant: z.boolean(),
  notes: text(1000).nullable()
})

const tripDocumentSchema = z.union([
  z.object({ docType: z.enum(DOCUMENT_TYPES), id }),
  z.object({ docType: z.enum(DOCUMENT_TYPES), token: text(100) })
])

export const tripSchema = shape<TripInput>()(
  z.object({
    branchId: nullableId.optional(),
    vehicleId: id,
    originCityId: id,
    destinationCityId: id,
    items: z.array(cargoItemSchema).max(200),
    passengers: z.array(passengerSchema).max(200).optional(),
    departureAt: text(30),
    arrivalAt: text(30),
    tripKind: z.enum(TRIP_KINDS),
    trailers: z.array(text(40)).max(10),
    driverId: nullableId,
    shipper: partySchema,
    receiver: partySchema,
    documents: z.array(tripDocumentSchema).max(20).optional()
  })
)

// Query strings are lenient: a missing or unusable value falls back to its default, as the portal
// may keep settings from an older version in the session
const queryInt = z.coerce.number().int().positive()
const optionalQuery = <T extends z.ZodType>(schema: T): z.ZodCatch<z.ZodOptional<T>> =>
  schema.optional().catch(undefined)
const DAY = /^\d{4}-\d{2}-\d{2}$/
const queryDay = z
  .string()
  .regex(DAY)
  .refine((v) => parseDay(v) !== null)

export const tripListQuerySchema = shape<TripListQuery>()(
  z.object({
    page: queryInt.catch(1).default(1),
    pageSize: z.coerce
      .number()
      .pipe(
        z.union(
          PAGE_SIZES.map((size) => z.literal(size)) as [
            z.ZodLiteral<25>,
            z.ZodLiteral<50>,
            z.ZodLiteral<100>
          ]
        )
      )
      .catch(DEFAULT_PAGE_SIZE)
      .default(DEFAULT_PAGE_SIZE),
    query: optionalQuery(
      z
        .string()
        .transform((v) => v.trim().slice(0, 80))
        .transform((v) => v || undefined)
    ),
    status: optionalQuery(z.enum(TRIP_STATUS_FILTERS)),
    category: optionalQuery(z.enum(TRIP_CATEGORIES)),
    tripKind: optionalQuery(z.enum(TRIP_KINDS)),
    cargoType: optionalQuery(z.enum(CARGO_TYPES)),
    vehicleId: optionalQuery(queryInt),
    driverId: optionalQuery(queryInt),
    branchId: optionalQuery(queryInt),
    from: optionalQuery(queryDay),
    to: optionalQuery(queryDay),
    sort: z.enum(TRIP_SORTS).catch('departureAt').default('departureAt'),
    direction: z.enum(['asc', 'desc']).catch('desc').default('desc'),
    group: optionalQuery(z.enum(TRIP_GROUPS)),
    lang: z.enum(['en', 'ar']).catch('en').default('en')
  })
)

export const govtSearchQuerySchema = z.object({
  query: z.string().max(200).catch('').default(''),
  originCityId: queryInt.nullable().catch(null).default(null),
  destinationCityId: queryInt.nullable().catch(null).default(null),
  page: optionalQuery(queryInt),
  pageSize: optionalQuery(queryInt)
})

// --- Government: dashboard, exports, settings, charges ------------------------------------------

// Longest custom range (about 5 years)
const MAX_RANGE_DAYS = 5 * 366

const dateRangeSchema = z.union([
  z.object({ preset: z.enum(RANGE_PRESETS) }),
  z.object({ preset: z.literal('custom'), from: text(10), to: text(10) }).refine(({ from, to }) => {
    const start = parseDay(from)
    const end = parseDay(to)
    return (
      start !== null &&
      end !== null &&
      start <= end &&
      (end.getTime() - start.getTime()) / 86_400_000 <= MAX_RANGE_DAYS
    )
  })
])

const stateName = z.string().min(1).max(80)

export const analyticsFiltersSchema = z.object({
  range: dateRangeSchema,
  originCityId: nullableId.optional(),
  destinationCityId: nullableId.optional(),
  originState: stateName.nullable().optional(),
  destinationState: stateName.nullable().optional(),
  category: z.enum(TRIP_CATEGORIES).nullable().optional(),
  cargoType: z.enum(CARGO_TYPES).nullable().optional(),
  vehicleType: z.enum(VEHICLE_TYPES).nullable().optional(),
  tripKind: z.enum(TRIP_KINDS).nullable().optional()
})

export const dashboardViewSchema = z.object({
  bucket: z.enum(BUCKET_SIZES).nullable(),
  breakdown: z.enum(BREAKDOWNS),
  sort: z.enum(BREAKDOWN_SORTS)
})

export const dashboardRequestSchema = z.object({
  filters: analyticsFiltersSchema,
  view: dashboardViewSchema
})

const labelMap = z.record(z.string().max(80), z.string().max(200))

export const exportSchema = z.object({
  filters: analyticsFiltersSchema,
  dateBasis: z.enum(DATE_BASES),
  status: z.enum(EXPORT_STATUSES),
  datasets: z.array(z.enum(EXPORT_DATASETS)).min(1).max(EXPORT_DATASETS.length),
  formats: z.array(z.enum(EXPORT_FORMATS)).min(1).max(EXPORT_FORMATS.length),
  includeIdNumbers: z.boolean().optional(),
  labels: z.object({
    sheets: labelMap,
    columns: z.record(z.string().max(80), labelMap),
    values: z.record(z.string().max(80), labelMap)
  })
})

const perCategory = z.object({ cargo: z.number(), passenger: z.number() })

export const settingsSchema = z.object({
  validityMarginHours: perCategory,
  averageSpeedKmh: perCategory
})

export const chargeSchema = z.object({
  name: text(),
  nameAr: text(),
  kind: z.enum(CHARGE_KINDS),
  cargoValue: z.number().nullable(),
  passengerValue: z.number().nullable(),
  active: z.boolean()
})

// --- Government: reports and decisions (reviews.ts) ---------------------------------------------

// Notes get a generous cap here; cleanNote applies the real limit (invalid_review)
const reviewNote = text(2_000)

export const reportSchema = shape<ReportInput>()(
  z.object({ manifestId: id, reason: z.enum(REPORT_REASONS), note: reviewNote })
)

export const dismissSchema = shape<DismissInput>()(z.object({ note: reviewNote }))

export const decisionSchema = shape<DecisionInput>()(
  z.object({ reason: z.enum(REPORT_REASONS).optional(), note: reviewNote })
)

export const cancelTripSchema = shape<CancelTripInput>()(
  z.object({ reason: z.enum(REPORT_REASONS), note: reviewNote })
)

export const reportListQuerySchema = shape<ReportListQuery>()(
  z.object({
    status: optionalQuery(z.enum(REPORT_STATUSES)),
    page: optionalQuery(queryInt),
    pageSize: optionalQuery(queryInt)
  })
)
