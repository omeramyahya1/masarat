import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { initDb, closeDb, getDb, vehicles, type NewVehicle } from './db'
import { getSession, logIn, logOut, signUp } from './services/auth'
import type { AuthResult, LogInInput, SignUpInput, UserRole } from '../shared/auth'

// Configure updater logging
autoUpdater.logger = log

let mainWindow: BrowserWindow | null = null
let updaterConfigured = false

function sendUpdateMessage(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

function configureAutoUpdater(): void {
  if (updaterConfigured) return
  updaterConfigured = true

  // Automatically download updates when available
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    sendUpdateMessage('updater:status', { status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    sendUpdateMessage('updater:status', {
      status: 'available',
      version: info.version
    })
  })

  autoUpdater.on('update-not-available', () => {
    sendUpdateMessage('updater:status', { status: 'not-available' })
  })

  autoUpdater.on('download-progress', (progressObj) => {
    sendUpdateMessage('updater:progress', {
      percent: Math.round(progressObj.percent),
      transferred: progressObj.transferred,
      total: progressObj.total
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateMessage('updater:status', {
      status: 'downloaded',
      version: info.version
    })
  })

  autoUpdater.on('error', (err) => {
    sendUpdateMessage('updater:status', {
      status: 'error',
      error: err ? err.message : 'Unknown error'
    })
  })

  // IPC Handlers for renderer
  ipcMain.handle('updater:check', async () => {
    try {
      return await autoUpdater.checkForUpdates()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to check for updates'
      log.error('Failed to check for updates:', err)
      return { error: message }
    }
  })

  ipcMain.handle('updater:quit-and-install', () => {
    autoUpdater.quitAndInstall()
  })
}

function createWindow(): void {
  // Create the browser window.
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Keep the updater pointed at the current window without retaining closed windows.
  mainWindow = window

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Check for updates once we are ready. electron-updater does not support
  // the supplied Linux build, so do not invoke it there.
  window.once('ready-to-show', () => {
    if (process.platform !== 'linux' && app.isPackaged) {
      autoUpdater.checkForUpdates().catch((err) => {
        log.error('Auto-check for updates failed:', err)
      })
    }
  })
}

// Database Handlers
function registerDbHandlers(): void {
  initDb()

  ipcMain.handle('db:get-vehicles', async () => {
    const db = getDb()
    return db.select().from(vehicles).all()
  })

  ipcMain.handle('db:add-vehicle', async (_event, data: NewVehicle) => {
    const db = getDb()
    return db.insert(vehicles).values(data).returning().get()
  })
}

// Auth Handlers
async function runAuth(action: () => Promise<AuthResult>): Promise<AuthResult> {
  try {
    return await action()
  } catch (err) {
    log.error('Auth request failed:', err)
    return { ok: false, error: 'unknown' }
  }
}

function registerAuthHandlers(): void {
  ipcMain.handle('auth:sign-up', (_event, input: SignUpInput) => runAuth(() => signUp(input)))
  ipcMain.handle('auth:log-in', (_event, input: LogInInput) => runAuth(() => logIn(input)))
  ipcMain.handle('auth:log-out', (_event, role: UserRole) => logOut(role))
  ipcMain.handle('auth:get-session', (_event, role: UserRole) => getSession(role))
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  registerDbHandlers()
  registerAuthHandlers()
  configureAutoUpdater()
  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  closeDb()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
