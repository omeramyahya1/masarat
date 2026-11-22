// The typed client the web apps use to reach the API, over fetch with the session cookie. Its
// shape follows the Electron MVP's window.api, except where the desktop did things natively: files
// are uploaded and downloaded, and documents print from the browser.
import type {
  AuthErrorCode,
  AuthResult,
  AuthUser,
  ChangePasswordInput,
  CompanyInput,
  CompanyProfile,
  LogInInput,
  ProfileInput,
  SignUpInput
} from '@masarat/shared/auth'
import type {
  BranchInput,
  BranchRecord,
  IssuedPassword,
  MemberRecord,
  MemberResult,
  MemberRoleInput,
  NewMemberInput,
  RoleInput,
  RoleRecord
} from '@masarat/shared/members'
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
import type {
  GovtSearchInput,
  GovtSearchResult,
  ManifestVerification,
  TripDetails
} from '@masarat/shared/billing'
import type { DashboardData } from '@masarat/shared/dashboard'
import type { AnalyticsFilters, DashboardView, CompanyOption } from '@masarat/shared/analytics'
import type { ExportInput, ExportRows } from '@masarat/shared/exports'
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
  // One page of the company's trips (a branch member's: their branch's), searched, filtered,
  // sorted and grouped by the API
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
  // Uploads a file the member chose; it's staged until the trip is saved
  upload: (docType: DocumentType, file: File) => Promise<FleetResult<StagedDocument>>
  // A saved attachment, for the preview
  file: (documentId: number) => Promise<FleetResult<DownloadedFile>>
}

// The accounts an admin manages: a company's Team (members.manage), or the government's Users
// (govt.users). The same calls on either side.
export interface MembersAPI {
  list: () => Promise<MemberResult<MemberRecord[]>>
  // The roles that can be given
  roles: () => Promise<MemberResult<RoleRecord[]>>
  create: (input: NewMemberInput) => Promise<MemberResult<IssuedPassword>>
  disable: (id: number) => Promise<MemberResult<MemberRecord>>
  enable: (id: number) => Promise<MemberResult<MemberRecord>>
  resetPassword: (id: number) => Promise<MemberResult<IssuedPassword>>
  changeRole: (id: number, input: MemberRoleInput) => Promise<MemberResult<MemberRecord>>
}

// The company's own administration
export interface CompanyAPI {
  // company.profile: the name, address and TIN printed on its manifests
  update: (
    input: CompanyInput
  ) => Promise<{ ok: true; data: CompanyProfile } | { ok: false; error: AuthErrorCode }>
  // Every member can list them
  branches: () => Promise<MemberResult<BranchRecord[]>>
  addBranch: (input: BranchInput) => Promise<MemberResult<BranchRecord>>
  updateBranch: (id: number, input: BranchInput) => Promise<MemberResult<BranchRecord>>
  // roles.manage; a built-in role can't be deleted, the company admin's can't be edited
  roles: () => Promise<MemberResult<RoleRecord[]>>
  addRole: (input: RoleInput) => Promise<MemberResult<RoleRecord>>
  updateRole: (id: number, input: RoleInput) => Promise<MemberResult<RoleRecord>>
  deleteRole: (id: number) => Promise<MemberResult<null>>
  members: MembersAPI
}

export interface GovtAPI {
  users: MembersAPI
  getReferenceData: () => Promise<FleetResult<TripReferenceData>>
  dashboard: (filters: AnalyticsFilters, view: DashboardView) => Promise<FleetResult<DashboardData>>
  listCompanies: () => Promise<FleetResult<CompanyOption[]>>
  // Trips of every company by bill ID, receipt/manifest number, trip number, plate, name or route
  // One page of the matches (input.page, input.pageSize)
  search: (input: GovtSearchInput) => Promise<FleetResult<Page<GovtSearchResult>>>
  // Any company's trip, read-only
  getTrip: (manifestId: number) => Promise<FleetResult<TripDetails>>
  // Any trip's attachment, for the preview
  documentFile: (documentId: number) => Promise<FleetResult<DownloadedFile>>
  // Raw data (trips, bills, cargo items, tax lines): one Excel or CSV file, or a ZIP of several,
  // with the rows written per dataset
  exportData: (input: ExportInput) => Promise<FleetResult<DownloadedFile & { rows: ExportRows }>>
  getTaxSettings: () => Promise<FleetResult<TaxSettingsView>>
  // Basis points per tax; each change is logged under the signed-in government user
  updateTaxRates: (input: TaxRatesInput) => Promise<FleetResult<TaxSettingsView>>
  // Demo only: rebuilds the seeded demo companies' data
  regenerateDemoData: () => Promise<FleetResult<null>>
}

export interface AuthAPI {
  // Creates a company and signs in as its admin
  signUp: (input: SignUpInput) => Promise<AuthResult>
  logIn: (input: LogInInput) => Promise<AuthResult>
  logOut: () => Promise<void>
  // The signed-in user, or null
  getSession: () => Promise<AuthUser | null>
  // The signed-in user's own name and phone
  updateProfile: (input: ProfileInput) => Promise<AuthResult>
  // Also replaces a temporary password; signs out the user's other sessions
  changePassword: (input: ChangePasswordInput) => Promise<AuthResult>
}

export interface ConfigAPI {
  // demoMode: the demo accounts list and the demo-only actions are shown
  get: () => Promise<{ ok: true; data: { demoMode: boolean } }>
}

// Public: what a manifest's QR code opens
export interface VerifyAPI {
  get: (token: string) => Promise<FleetResult<ManifestVerification>>
}

export interface MasaratApi {
  config: ConfigAPI
  verify: VerifyAPI
  auth: AuthAPI
  company: CompanyAPI
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
): Promise<FleetResult<DownloadedFile & { response: Response }>> {
  const response = await send(method, path, body)
  if (!response.ok) return (await response.json()) as FleetResult<never>
  return {
    ok: true,
    data: { blob: await response.blob(), fileName: fileNameOf(response, 'file'), response }
  }
}

// A download without its response, which only the export reads
async function file(path: string): Promise<FleetResult<DownloadedFile>> {
  const result = await download('GET', path)
  return result.ok
    ? { ok: true, data: { blob: result.data.blob, fileName: result.data.fileName } }
    : result
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
  file: (id) => file(`/documents/${id}/file`)
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

const membersAt = (base: string): MembersAPI => ({
  list: () => request('GET', base),
  roles: () => request('GET', `${base}/roles`),
  create: (input) => request('POST', base, input),
  disable: (id) => request('POST', `${base}/${id}/disable`),
  enable: (id) => request('POST', `${base}/${id}/enable`),
  resetPassword: (id) => request('POST', `${base}/${id}/reset-password`),
  changeRole: (id, input) => request('PUT', `${base}/${id}/role`, input)
})

const company: CompanyAPI = {
  update: (input) => request('PUT', '/company', input),
  branches: () => request('GET', '/branches'),
  addBranch: (input) => request('POST', '/branches', input),
  updateBranch: (id, input) => request('PUT', `/branches/${id}`, input),
  roles: () => request('GET', '/roles'),
  addRole: (input) => request('POST', '/roles', input),
  updateRole: (id, input) => request('PUT', `/roles/${id}`, input),
  deleteRole: (id) => request('DELETE', `/roles/${id}`),
  members: membersAt('/members')
}

const govt: GovtAPI = {
  users: membersAt('/govt/users'),
  getReferenceData: () => request('GET', '/govt/reference'),
  dashboard: (filters, view) => request('POST', '/govt/dashboard', { filters, view }),
  listCompanies: () => request('GET', '/govt/companies'),
  search: (input) => request('GET', `/govt/search${queryString(input)}`),
  getTrip: (id) => request('GET', `/govt/trips/${id}`),
  documentFile: (id) => file(`/govt/documents/${id}/file`),
  exportData: async (input) => {
    const result = await download('POST', '/govt/exports', input)
    if (!result.ok) return result
    const { blob, fileName, response } = result.data
    let rows: ExportRows = {}
    try {
      rows = JSON.parse(response.headers.get('x-export-rows') ?? '{}') as ExportRows
    } catch {
      // The counts are only for the dialog's summary
    }
    return { ok: true, data: { blob, fileName, rows } }
  },
  getTaxSettings: () => request('GET', '/govt/tax-settings'),
  updateTaxRates: (input) => request('PUT', '/govt/tax-settings', input),
  regenerateDemoData: () => request('POST', '/govt/demo/regenerate')
}

const config: ConfigAPI = {
  get: () => request('GET', '/config')
}

const verify: VerifyAPI = {
  get: (token) => request('GET', `/verify/${encodeURIComponent(token)}`)
}

export const api: MasaratApi = {
  config,
  verify,
  auth,
  company,
  fleet,
  trips,
  billing,
  documents,
  govt
}
