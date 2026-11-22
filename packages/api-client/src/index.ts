// The typed client the web apps use to reach the API. Its shape is still mostly the Electron MVP's
// window.api (see apps/desktop-demo/src/preload/index.d.ts), so the moved UI code compiles as is.
// Wired so far: config, auth and govt.users. Every other call rejects with "not wired yet".
// TODO(web): wire the rest, and adapt the calls that only made sense on the desktop: file
// picking, opening files and saving PDFs.
import type {
  AuthResult,
  AuthUser,
  ChangePasswordInput,
  LogInInput,
  ProfileInput,
  SignUpInput
} from '@masarat/shared/auth'
import type {
  GovtUserRecord,
  GovtUserResult,
  IssuedPassword,
  NewGovtUserInput
} from '@masarat/shared/govtUsers'
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

// Government admins only
export interface GovtUsersAPI {
  list: () => Promise<GovtUserResult<GovtUserRecord[]>>
  create: (input: NewGovtUserInput) => Promise<GovtUserResult<IssuedPassword>>
  disable: (id: number) => Promise<GovtUserResult<GovtUserRecord>>
  enable: (id: number) => Promise<GovtUserResult<GovtUserRecord>>
  resetPassword: (id: number) => Promise<GovtUserResult<IssuedPassword>>
  setAdmin: (id: number, isAdmin: boolean) => Promise<GovtUserResult<GovtUserRecord>>
}

export interface GovtAPI {
  users: GovtUsersAPI
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
  // Fleet owners only
  signUp: (input: SignUpInput) => Promise<AuthResult>
  logIn: (input: LogInInput) => Promise<AuthResult>
  logOut: () => Promise<void>
  // The signed-in user, or null
  getSession: () => Promise<AuthUser | null>
  // The signed-in fleet owner's own details (name, phone, company, address, TIN)
  updateProfile: (input: ProfileInput) => Promise<AuthResult>
  // Also replaces a temporary password; signs out the user's other sessions
  changePassword: (input: ChangePasswordInput) => Promise<AuthResult>
}

export interface ConfigAPI {
  // demoMode: the demo accounts list and the demo-only actions are shown
  get: () => Promise<{ ok: true; data: { demoMode: boolean } }>
}

export interface MasaratApi {
  config: ConfigAPI
  auth: AuthAPI
  fleet: FleetAPI
  trips: TripsAPI
  billing: BillingAPI
  documents: DocumentsAPI
  certificates: CertificatesAPI
  govt: GovtAPI
}

// api.masarat.com in production; set per web app in its .env (VITE_API_URL)
const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

// Fired when the API says the session has ended, so the app can send the user to log in again
export const SIGNED_OUT_EVENT = 'masarat:signed-out'

// One JSON call with the session cookie. The API answers errors with the same { ok, error } body
// as successes, so the body is returned whatever the status.
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const result = (await response.json()) as T
  if (response.status === 401 && path !== '/auth/me' && path !== '/auth/login') {
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
  }
  return result
}

const auth: AuthAPI = {
  signUp: (input) => request('POST', '/auth/signup', input),
  logIn: (input) => request('POST', '/auth/login', input),
  logOut: async () => {
    await request('POST', '/auth/logout')
  },
  getSession: async () => {
    const result = await request<AuthResult>('GET', '/auth/me')
    return result.ok ? result.user : null
  },
  updateProfile: (input) => request('PATCH', '/auth/profile', input),
  changePassword: (input) => request('POST', '/auth/change-password', input)
}

const users: GovtUsersAPI = {
  list: () => request('GET', '/govt/users'),
  create: (input) => request('POST', '/govt/users', input),
  disable: (id) => request('POST', `/govt/users/${id}/disable`),
  enable: (id) => request('POST', `/govt/users/${id}/enable`),
  resetPassword: (id) => request('POST', `/govt/users/${id}/reset-password`),
  setAdmin: (id, isAdmin) => request('POST', `/govt/users/${id}/admin`, { isAdmin })
}

const config: ConfigAPI = {
  get: () => request('GET', '/config')
}

// Calls without a route yet reject until they're wired
const notWired = (path: string): Promise<never> =>
  Promise.reject(new Error(`api.${path} is not wired to the API yet`))

function group<T extends object>(name: string, wired: Partial<T> = {}): T {
  return new Proxy(wired, {
    get: (target, method: string) =>
      method in target ? target[method as keyof typeof target] : () => notWired(`${name}.${method}`)
  }) as T
}

export const api: MasaratApi = {
  config,
  auth,
  fleet: group('fleet'),
  trips: group('trips'),
  billing: group('billing'),
  documents: group('documents'),
  certificates: group('certificates'),
  govt: group<GovtAPI>('govt', { users })
}
