import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
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

// Custom APIs for renderer
const api = {
  auth: {
    signUp: (input: SignUpInput): Promise<AuthResult> => ipcRenderer.invoke('auth:sign-up', input),
    logIn: (input: LogInInput): Promise<AuthResult> => ipcRenderer.invoke('auth:log-in', input),
    logOut: (role: UserRole): Promise<void> => ipcRenderer.invoke('auth:log-out', role),
    getSession: (role: UserRole): Promise<AuthUser | null> =>
      ipcRenderer.invoke('auth:get-session', role)
  },
  fleet: {
    listVehicles: (): Promise<FleetResult<VehicleRecord[]>> =>
      ipcRenderer.invoke('fleet:list-vehicles'),
    addVehicle: (input: VehicleInput): Promise<FleetResult<VehicleRecord>> =>
      ipcRenderer.invoke('fleet:add-vehicle', input),
    updateVehicle: (id: number, input: VehicleInput): Promise<FleetResult<VehicleRecord>> =>
      ipcRenderer.invoke('fleet:update-vehicle', id, input),
    deleteVehicle: (id: number): Promise<FleetResult<null>> =>
      ipcRenderer.invoke('fleet:delete-vehicle', id)
  },
  trips: {
    getReferenceData: (): Promise<FleetResult<TripReferenceData>> =>
      ipcRenderer.invoke('trips:get-reference-data'),
    list: (): Promise<FleetResult<TripRecord[]>> => ipcRenderer.invoke('trips:list'),
    create: (input: TripInput): Promise<FleetResult<TripRecord>> =>
      ipcRenderer.invoke('trips:create', input)
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
