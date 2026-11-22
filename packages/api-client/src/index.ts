// The typed client the web apps use to reach the API, over fetch with the session cookie. Its
// shape follows the Electron MVP's window.api, except where the desktop did things natively: files
// are uploaded and downloaded, and documents print from the browser.
// TODO(web): the government's calls other than govt.users still reject with "not wired yet".
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
  TripListQuery,
  VehicleInput,
  VehicleRecord
} from '@masarat/shared/fleet'
import type { Page } from '@masarat/shared/paging'
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
  // One page of the owner's trips, searched, filtered, sorted and grouped by the API
  list: (query: TripListQuery) => Promise<FleetResult<Page<TripRecord>>>
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

// A file the API sent, with the name it should be saved under
export interface DownloadedFile {
  blob: Blob
  fileName: string
}

export interface DocumentsAPI {
  // Uploads a file the owner chose; it's staged until the trip is saved
  upload: (docType: DocumentType, file: File) => Promise<FleetResult<StagedDocument>>
  // A saved attachment, for the preview
  file: (documentId: number) => Promise<FleetResult<DownloadedFile>>
  // Simulated OCR: reads a staged or saved attachment to fill in the trip form
  scan: (input: ScanInput) => Promise<FleetResult<OcrResult>>
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
  // Any trip's attachment, for the preview
  documentFile: (documentId: number) => Promise<FleetResult<DownloadedFile>>
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
  govt: GovtAPI
}

// api.masarat.com in production; set per web app in its .env (VITE_API_URL)
const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

// Fired when the API says the session has ended, so the app can send the user to log in again
export const SIGNED_OUT_EVENT = 'masarat:signed-out'

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const form = body instanceof FormData
  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    // A FormData body sets its own multipart Content-Type
    headers: body === undefined || form ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body)
  })
  if (response.status === 401 && path !== '/auth/me' && path !== '/auth/login') {
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
  }
  return response
}

// One JSON call with the session cookie. The API answers errors with the same { ok, error } body
// as successes, so the body is returned whatever the status.
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await (await send(method, path, body)).json()) as T
}

// The file name from Content-Disposition, preferring the UTF-8 form (Arabic names)
function fileNameOf(response: Response, fallback: string): string {
  const header = response.headers.get('content-disposition') ?? ''
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1])
    } catch {
      // Fall through to the plain name
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1] ?? fallback
}

// A file from the API, or its { ok: false, error } when it couldn't be sent
async function download(
  method: string,
  path: string,
  body?: unknown
): Promise<FleetResult<DownloadedFile>> {
  const response = await send(method, path, body)
  if (!response.ok) return (await response.json()) as FleetResult<DownloadedFile>
  return { ok: true, data: { blob: await response.blob(), fileName: fileNameOf(response, 'file') } }
}

// Query string from the set values; arrays and objects aren't used here
function queryString(values: object): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

const fleet: FleetAPI = {
  listVehicles: () => request('GET', '/vehicles'),
  addVehicle: (input) => request('POST', '/vehicles', input),
  updateVehicle: (id, input) => request('PUT', `/vehicles/${id}`, input),
  deleteVehicle: (id) => request('DELETE', `/vehicles/${id}`),
  listDrivers: () => request('GET', '/drivers'),
  addDriver: (input) => request('POST', '/drivers', input),
  updateDriver: (id, input) => request('PUT', `/drivers/${id}`, input),
  deleteDriver: (id) => request('DELETE', `/drivers/${id}`)
}

const trips: TripsAPI = {
  getReferenceData: () => request('GET', '/trips/reference'),
  list: (query) => request('GET', `/trips${queryString(query)}`),
  suggestions: () => request('GET', '/trips/suggestions'),
  create: (input) => request('POST', '/trips', input),
  update: (id, input) => request('PUT', `/trips/${id}`, input),
  delete: (id) => request('DELETE', `/trips/${id}`)
}

const billing: BillingAPI = {
  getTrip: (id) => request('GET', `/trips/${id}`),
  generate: (id) => request('POST', `/trips/${id}/bill`),
  refresh: (id) => request('POST', `/trips/${id}/refresh`),
  simulatePayment: (id) => request('POST', `/trips/${id}/simulate-payment`)
}

const documents: DocumentsAPI = {
  upload: (docType, file) => {
    const form = new FormData()
    form.set('docType', docType)
    form.set('file', file)
    return request('POST', '/documents', form)
  },
  file: (id) => download('GET', `/documents/${id}/file`),
  scan: (input) => request('POST', '/documents/scan', input)
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
  fleet,
  trips,
  billing,
  documents,
  govt: group<GovtAPI>('govt', { users })
}
