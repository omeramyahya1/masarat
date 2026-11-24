// The government's raw data export (CSV / Excel): datasets, their columns, and the options the
// export dialog sends. The column headers and value labels come from the renderer's Arabic
// translations, so every visible string stays in the locale files.
import type { AnalyticsFilters } from './analytics'

export const EXPORT_DATASETS = ['trips', 'bills', 'items', 'passengers', 'taxLines'] as const
export type ExportDataset = (typeof EXPORT_DATASETS)[number]

export const EXPORT_COLUMNS = {
  trips: [
    'tripId',
    'manifestNo',
    'departureAt',
    'arrivalAt',
    'createdAt',
    'status',
    'category',
    'company',
    'plate',
    'registrationNo',
    'vehicleType',
    'trailers',
    'tripKind',
    'origin',
    'originState',
    'destination',
    'destinationState',
    'distanceKm',
    'driverName',
    'driverPhone',
    'shipperName',
    'receiverName',
    'cargoTypes',
    'cargoQuantity',
    'cargoUnit',
    'ticketPrice',
    'tripCost',
    'amountDue',
    'billId',
    'paidAt'
  ],
  bills: [
    'billId',
    'tripId',
    'manifestNo',
    'company',
    'plate',
    'amount',
    'status',
    'issuedAt',
    'paidAt',
    'paymentRef'
  ],
  items: [
    'tripId',
    'manifestNo',
    'position',
    'description',
    'cargoType',
    'packingType',
    'packageCount',
    'quantity',
    'unit',
    'cost',
    'notes'
  ],
  // A passenger trip's passengers. Their ID numbers only with includeIdNumbers.
  passengers: [
    'tripId',
    'manifestNo',
    'departureAt',
    'seatNo',
    'fullName',
    'isInfant',
    'idType',
    'idNumber',
    'notes'
  ],
  taxLines: ['tripId', 'manifestNo', 'billId', 'line', 'rate', 'amount', 'paidAt']
} as const satisfies Record<ExportDataset, readonly string[]>

// Personal data left out of a file unless the export asks for it
export const ID_COLUMNS: readonly string[] = ['idType', 'idNumber']

// A dataset's columns in this export
export const exportColumns = (
  dataset: ExportDataset,
  includeIdNumbers: boolean | undefined
): readonly string[] =>
  includeIdNumbers
    ? EXPORT_COLUMNS[dataset]
    : EXPORT_COLUMNS[dataset].filter((c) => !ID_COLUMNS.includes(c))

// Which date the period applies to
export const DATE_BASES = ['trip', 'billed', 'paid'] as const
export type DateBasis = (typeof DATE_BASES)[number]

// Trip statuses to include
export const EXPORT_STATUSES = ['all', 'draft', 'billed', 'certified'] as const
export type ExportStatus = (typeof EXPORT_STATUSES)[number]

export const EXPORT_FORMATS = ['xlsx', 'csv'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

// Translations the main process writes into the files
export interface ExportLabels {
  sheets: Record<ExportDataset, string>
  columns: Record<ExportDataset, Record<string, string>>
  // Value labels by group (statuses, cargoTypes, vehicleTypes, tripKinds, units,
  // paymentStatuses), each keyed by its stored value
  values: Record<string, Record<string, string>>
}

export interface ExportInput {
  filters: AnalyticsFilters
  dateBasis: DateBasis
  status: ExportStatus
  datasets: ExportDataset[]
  // One or both; files of more than one kind go into a folder
  formats: ExportFormat[]
  // Passengers' ID types and numbers in the passengers dataset; off unless asked for
  includeIdNumbers?: boolean
  labels: ExportLabels
}

// The most data rows an Excel sheet holds (1,048,576 rows, one of them the header). An export that
// would pass it in any dataset is refused for Excel; CSV has no limit.
export const EXCEL_MAX_ROWS = 1_048_575

// Rows written per dataset
export type ExportRows = Partial<Record<ExportDataset, number>>

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isOneOf = <T>(list: readonly T[], value: unknown): value is T =>
  (list as readonly unknown[]).includes(value)

// The parts other than the filters (checked with isAnalyticsFilters)
export function isExportOptions(value: unknown): value is Omit<ExportInput, 'filters'> {
  const v = value as Partial<ExportInput> | null
  if (!v || typeof v !== 'object') return false
  return (
    isOneOf(DATE_BASES, v.dateBasis) &&
    isOneOf(EXPORT_STATUSES, v.status) &&
    Array.isArray(v.formats) &&
    v.formats.length > 0 &&
    v.formats.every((f) => isOneOf(EXPORT_FORMATS, f)) &&
    Array.isArray(v.datasets) &&
    v.datasets.length > 0 &&
    v.datasets.every((d) => isOneOf(EXPORT_DATASETS, d)) &&
    (v.includeIdNumbers === undefined || typeof v.includeIdNumbers === 'boolean') &&
    isObject(v.labels) &&
    isObject(v.labels.columns) &&
    isObject(v.labels.sheets) &&
    isObject(v.labels.values)
  )
}
