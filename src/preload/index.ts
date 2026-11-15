import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

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

// Custom APIs for renderer
const api = {
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
