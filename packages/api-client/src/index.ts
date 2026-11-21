// The typed client both portals use to reach the API. Its shape is still the Electron MVP's
// window.api (see apps/desktop-demo/src/preload/index.d.ts), so the moved UI code compiles as is.
// TODO(web): wire it to the Hono API (Hono RPC client or fetch) and adapt the calls that only
// made sense on the desktop: file picking, opening files and saving PDFs.
import type {
  AuthResult,
  AuthUser,
  LogInInput,
  ProfileInput,
  SignUpInput,
  UserRole
} from '@masarat/shared/auth'
import type {
  DocumentType,
  DriverInput,
  DriverRecord,
  FleetResult,
  StagedDocument,
  TripInput,
  TripRecord,
  TripReferenceData,
  TripSuggestions,
  VehicleInput,
  VehicleRecord
} from '@masarat/shared/fleet'
import type { GovtSearchInput, GovtSearchResult, TripDetails } from '@masarat/shared/billing'
import type { DashboardData } from '@masarat/shared/dashboard'
import type { AnalyticsFilters, DashboardView, OwnerOption } from '@masarat/shared/analytics'
import type { ExportInput, ExportResult } from '@masarat/shared/exports'
import type { OcrResult, ScanInput } from '@masarat/shared/ocr'
import type { TaxRatesInput, TaxSettingsView } from '@masarat/shared/tax'

export interface FleetAPI {
  listVehicles: () => Promise<FleetResult<VehicleRecord[]>>
  addVehicle: (input: VehicleInput) => Promise<FleetResult<VehicleRecord>>
  updateVehicle: (id: number, input: VehicleInput) => Promise<FleetResult<VehicleRecord>>
  deleteVehicle: (id: number) => Promise<FleetResult<null>>
  listDrivers: () => Promise<FleetResult<DriverRecord[]>>
  addDriver: (input: DriverInput) => Promise<FleetResult<DriverRecord>>
  updateDriver: (id: number, input: DriverInput) => Promise<FleetResult<DriverRecord>>
  deleteDriver: (id: number) => Promise<FleetResult<null>>
}

export interface TripsAPI {
  getReferenceData: () => Promise<FleetResult<TripReferenceData>>
  list: () => Promise<FleetResult<TripRecord[]>>
  // Earlier senders, receivers and packing types, for the trip form
  suggestions: () => Promise<FleetResult<TripSuggestions>>
  create: (input: TripInput) => Promise<FleetResult<TripRecord>>
  // Drafts only
  update: (id: number, input: TripInput) => Promise<FleetResult<TripRecord>>
  // Drafts only; removes the trip for good
  delete: (id: number) => Promise<FleetResult<null>>
}

export interface BillingAPI {
  getTrip: (manifestId: number) => Promise<FleetResult<TripDetails>>
  // incomplete_manifest until missingForBilling is empty
  generate: (manifestId: number) => Promise<FleetResult<TripDetails>>
  refresh: (manifestId: number) => Promise<FleetResult<TripDetails>>
  // Demo only: pays the bill at the simulated E-Sali
  simulatePayment: (manifestId: number) => Promise<FleetResult<null>>
}

export interface DocumentsAPI {
  // Opens a file picker and stages the file until the trip is saved; null data if cancelled
  pick: (docType: DocumentType) => Promise<FleetResult<StagedDocument | null>>
  // Opens a saved attachment in the system viewer
  open: (documentId: number) => Promise<FleetResult<null>>
  // Simulated OCR: reads a staged or saved attachment to fill in the trip form
  scan: (input: ScanInput) => Promise<FleetResult<OcrResult>>
}

export interface CertificatesAPI {
  // Prints the current page (certificate print styles) to a PDF the user saves
  savePdf: (fileName: string) => Promise<FleetResult<{ saved: boolean }>>
}

export interface GovtAPI {
  getReferenceData: () => Promise<FleetResult<TripReferenceData>>
  dashboard: (filters: AnalyticsFilters, view: DashboardView) => Promise<FleetResult<DashboardData>>
  listOwners: () => Promise<FleetResult<OwnerOption[]>>
  // Trips of every owner by bill ID, receipt/manifest number, trip number, plate, name or route
  search: (input: GovtSearchInput) => Promise<FleetResult<GovtSearchResult[]>>
  // Any owner's trip, read-only
  getTrip: (manifestId: number) => Promise<FleetResult<TripDetails>>
  openDocument: (documentId: number) => Promise<FleetResult<null>>
  // Prints the open report (its print styles) to a PDF the user saves
  saveReportPdf: (fileName: string) => Promise<FleetResult<{ saved: boolean }>>
  // Raw data (trips, bills, cargo items, tax lines) as an Excel workbook or CSV files
  exportData: (input: ExportInput) => Promise<FleetResult<ExportResult>>
  getTaxSettings: () => Promise<FleetResult<TaxSettingsView>>
  // Basis points per tax; each change is logged under the signed-in government user
  updateTaxRates: (input: TaxRatesInput) => Promise<FleetResult<TaxSettingsView>>
  // Demo only: rebuilds the seeded demo owners' data
  regenerateDemoData: () => Promise<FleetResult<null>>
}

export interface AuthAPI {
  signUp: (input: SignUpInput) => Promise<AuthResult>
  logIn: (input: LogInInput) => Promise<AuthResult>
  logOut: (role: UserRole) => Promise<void>
  getSession: (role: UserRole) => Promise<AuthUser | null>
  // The signed-in fleet owner's own details (name, phone, company, address, TIN)
  updateProfile: (input: ProfileInput) => Promise<AuthResult>
}

export interface MasaratApi {
  auth: AuthAPI
  fleet: FleetAPI
  trips: TripsAPI
  billing: BillingAPI
  documents: DocumentsAPI
  certificates: CertificatesAPI
  govt: GovtAPI
}

// Every call rejects until the client is wired to the API
const notWired = (path: string): Promise<never> =>
  Promise.reject(new Error(`api.${path} is not wired to the API yet`))

export const api = new Proxy({} as MasaratApi, {
  get: (_target, group: string) =>
    new Proxy({}, { get: (_t, method: string) => () => notWired(`${group}.${method}`) })
}) as MasaratApi
