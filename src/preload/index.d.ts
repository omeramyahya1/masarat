import { ElectronAPI } from '@electron-toolkit/preload'
import type { AuthResult, AuthUser, LogInInput, SignUpInput, UserRole } from '../shared/auth'
import type {
  FleetResult,
  TripInput,
  TripRecord,
  TripReferenceData,
  VehicleInput,
  VehicleRecord
} from '../shared/fleet'
import type { TripDetails } from '../shared/billing'

export interface UpdateStatus {
  status:
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'unsupported'
  version?: string
  error?: string
}

export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
}

export interface UpdaterAPI {
  checkForUpdates: () => Promise<unknown>
  quitAndInstall: () => Promise<void>
  onStatusChange: (callback: (status: UpdateStatus) => void) => () => void
  onProgress: (callback: (progress: UpdateProgress) => void) => () => void
}

export interface FleetAPI {
  listVehicles: () => Promise<FleetResult<VehicleRecord[]>>
  addVehicle: (input: VehicleInput) => Promise<FleetResult<VehicleRecord>>
  updateVehicle: (id: number, input: VehicleInput) => Promise<FleetResult<VehicleRecord>>
  deleteVehicle: (id: number) => Promise<FleetResult<null>>
}

export interface TripsAPI {
  getReferenceData: () => Promise<FleetResult<TripReferenceData>>
  list: () => Promise<FleetResult<TripRecord[]>>
  create: (input: TripInput) => Promise<FleetResult<TripRecord>>
}

export interface BillingAPI {
  getTrip: (manifestId: number) => Promise<FleetResult<TripDetails>>
  generate: (manifestId: number) => Promise<FleetResult<TripDetails>>
  refresh: (manifestId: number) => Promise<FleetResult<TripDetails>>
  // Demo only: pays the bill at the simulated E-Sali
  simulatePayment: (manifestId: number) => Promise<FleetResult<null>>
}

export interface CertificatesAPI {
  // Prints the current page (certificate print styles) to a PDF the user saves
  savePdf: (fileName: string) => Promise<FleetResult<{ saved: boolean }>>
}

export interface AuthAPI {
  signUp: (input: SignUpInput) => Promise<AuthResult>
  logIn: (input: LogInInput) => Promise<AuthResult>
  logOut: (role: UserRole) => Promise<void>
  getSession: (role: UserRole) => Promise<AuthUser | null>
}

export interface CustomAPI {
  auth: AuthAPI
  fleet: FleetAPI
  trips: TripsAPI
  billing: BillingAPI
  certificates: CertificatesAPI
  updater: UpdaterAPI
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: CustomAPI
  }
}
