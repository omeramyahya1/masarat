import { ElectronAPI } from '@electron-toolkit/preload'

export interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
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

export interface CustomAPI {
  updater: UpdaterAPI
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: CustomAPI
  }
}
