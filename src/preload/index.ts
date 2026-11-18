import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AuthResult,
  AuthUser,
  LogInInput,
  ProfileInput,
  SignUpInput,
  UserRole
} from '../shared/auth'
import type {
  DriverInput,
  DriverRecord,
  FleetResult,
  TripInput,
  TripRecord,
  TripReferenceData,
  VehicleInput,
  VehicleRecord
} from '../shared/fleet'
import type { TripDetails } from '../shared/billing'
import type { DashboardData, DashboardPeriod } from '../shared/dashboard'
import type { TaxRatesInput, TaxSettingsView } from '../shared/tax'

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

// Custom APIs for renderer
const api = {
  auth: {
    signUp: (input: SignUpInput): Promise<AuthResult> => ipcRenderer.invoke('auth:sign-up', input),
    logIn: (input: LogInInput): Promise<AuthResult> => ipcRenderer.invoke('auth:log-in', input),
    logOut: (role: UserRole): Promise<void> => ipcRenderer.invoke('auth:log-out', role),
    getSession: (role: UserRole): Promise<AuthUser | null> =>
      ipcRenderer.invoke('auth:get-session', role),
    updateProfile: (input: ProfileInput): Promise<AuthResult> =>
      ipcRenderer.invoke('auth:update-profile', input)
  },
  fleet: {
    listVehicles: (): Promise<FleetResult<VehicleRecord[]>> =>
      ipcRenderer.invoke('fleet:list-vehicles'),
    addVehicle: (input: VehicleInput): Promise<FleetResult<VehicleRecord>> =>
      ipcRenderer.invoke('fleet:add-vehicle', input),
    updateVehicle: (id: number, input: VehicleInput): Promise<FleetResult<VehicleRecord>> =>
      ipcRenderer.invoke('fleet:update-vehicle', id, input),
    deleteVehicle: (id: number): Promise<FleetResult<null>> =>
      ipcRenderer.invoke('fleet:delete-vehicle', id),
    listDrivers: (): Promise<FleetResult<DriverRecord[]>> =>
      ipcRenderer.invoke('fleet:list-drivers'),
    addDriver: (input: DriverInput): Promise<FleetResult<DriverRecord>> =>
      ipcRenderer.invoke('fleet:add-driver', input),
    updateDriver: (id: number, input: DriverInput): Promise<FleetResult<DriverRecord>> =>
      ipcRenderer.invoke('fleet:update-driver', id, input),
    deleteDriver: (id: number): Promise<FleetResult<null>> =>
      ipcRenderer.invoke('fleet:delete-driver', id)
  },
  trips: {
    getReferenceData: (): Promise<FleetResult<TripReferenceData>> =>
      ipcRenderer.invoke('trips:get-reference-data'),
    list: (): Promise<FleetResult<TripRecord[]>> => ipcRenderer.invoke('trips:list'),
    create: (input: TripInput): Promise<FleetResult<TripRecord>> =>
      ipcRenderer.invoke('trips:create', input),
    update: (id: number, input: TripInput): Promise<FleetResult<TripRecord>> =>
      ipcRenderer.invoke('trips:update', id, input),
    delete: (id: number): Promise<FleetResult<null>> => ipcRenderer.invoke('trips:delete', id)
  },
  billing: {
    getTrip: (manifestId: number): Promise<FleetResult<TripDetails>> =>
      ipcRenderer.invoke('billing:get-trip', manifestId),
    generate: (manifestId: number): Promise<FleetResult<TripDetails>> =>
      ipcRenderer.invoke('billing:generate', manifestId),
    refresh: (manifestId: number): Promise<FleetResult<TripDetails>> =>
      ipcRenderer.invoke('billing:refresh', manifestId),
    simulatePayment: (manifestId: number): Promise<FleetResult<null>> =>
      ipcRenderer.invoke('billing:simulate-payment', manifestId)
  },
  certificates: {
    savePdf: (fileName: string): Promise<FleetResult<{ saved: boolean }>> =>
      ipcRenderer.invoke('certificates:save-pdf', fileName)
  },
  govt: {
    getReferenceData: (): Promise<FleetResult<TripReferenceData>> =>
      ipcRenderer.invoke('govt:get-reference-data'),
    dashboard: (period: DashboardPeriod): Promise<FleetResult<DashboardData>> =>
      ipcRenderer.invoke('govt:dashboard', period),
    getTaxSettings: (): Promise<FleetResult<TaxSettingsView>> =>
      ipcRenderer.invoke('govt:get-tax-settings'),
    updateTaxRates: (input: TaxRatesInput): Promise<FleetResult<TaxSettingsView>> =>
      ipcRenderer.invoke('govt:update-tax-rates', input),
    regenerateDemoData: (): Promise<FleetResult<null>> => ipcRenderer.invoke('govt:regenerate-demo')
  },
  updater: {
    checkForUpdates: (): Promise<unknown> => ipcRenderer.invoke('updater:check'),
    quitAndInstall: (): Promise<void> => ipcRenderer.invoke('updater:quit-and-install'),
    onStatusChange: (callback: (status: UpdateStatus) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, data: UpdateStatus): void => callback(data)
      ipcRenderer.on('updater:status', listener)
      return (): void => {
        ipcRenderer.removeListener('updater:status', listener)
      }
    },
    onProgress: (callback: (progress: UpdateProgress) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, data: UpdateProgress): void => callback(data)
      ipcRenderer.on('updater:progress', listener)
      return (): void => {
        ipcRenderer.removeListener('updater:progress', listener)
      }
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
