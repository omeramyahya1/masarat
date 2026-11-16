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
  updater: UpdaterAPI
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: CustomAPI
  }
}
