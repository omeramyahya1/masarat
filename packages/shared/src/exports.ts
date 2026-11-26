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

// Exports run as jobs on the export worker (apps/api/src/exportWorker.ts), queued in Redis: the
// API queues one, the portal follows it and downloads the file once it's ready
export const EXPORT_JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const
export type ExportJobStatus = (typeof EXPORT_JOB_STATUSES)[number]

// How long a finished export's file can be downloaded
export const EXPORT_FILE_TTL_MS = 60 * 60 * 1000

export interface ExportJob {
  id: string
  status: ExportJobStatus
  // While queued: how many exports are ahead of it
  ahead: number | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  // Why it failed (the same codes as before exports were queued) and, for the size limits, the
  // counts per dataset
  error: 'export_too_large_for_excel' | 'export_too_large' | 'export_failed' | null
  rows: ExportRows | null
  // Once done: the file to download (one file, or a ZIP of several)
  fileName: string | null
}
