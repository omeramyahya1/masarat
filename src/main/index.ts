import { app, shell, BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'fs/promises'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { initDb, closeDb } from './db'
import { getSession, logIn, logOut, signUp, updateProfile } from './services/auth'
import { addVehicle, deleteVehicle, listVehicles, updateVehicle } from './services/fleet'
import { addDriver, deleteDriver, listDrivers, updateDriver } from './services/drivers'
import { createTrip, deleteTrip, getReferenceData, listTrips, updateTrip } from './services/trips'
import {
  generateBill,
  getTripDetails,
  refreshBillStatus,
  simulatePayment
} from './services/billing'
import { getDashboard } from './services/dashboard'
import { getTaxSettingsView, updateTaxRates } from './services/taxes'
import { ensureDemoData, regenerateDemoData } from './services/demoData'
import type { AuthResult, LogInInput, ProfileInput, SignUpInput, UserRole } from '../shared/auth'
import type { TaxRatesInput } from '../shared/tax'
import type { DriverInput, FleetResult, TripInput, VehicleInput } from '../shared/fleet'
import { isDashboardPeriod } from '../shared/dashboard'

// Configure updater logging
autoUpdater.logger = log

let mainWindow: BrowserWindow | null = null
let updaterConfigured = false

function sendUpdateMessage(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

// electron-updater only works in packaged builds, and on Linux only when running as an AppImage
function canAutoUpdate(): boolean {
  return app.isPackaged && (process.platform !== 'linux' || Boolean(process.env.APPIMAGE))
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
    if (!canAutoUpdate()) {
      sendUpdateMessage('updater:status', { status: 'unsupported' })
      return null
    }
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

  // Check for updates once we are ready (see canAutoUpdate for supported builds)
  window.once('ready-to-show', () => {
    if (canAutoUpdate()) {
      autoUpdater.checkForUpdates().catch((err) => {
        log.error('Auto-check for updates failed:', err)
      })
    }
  })
}

// Fleet and trip handlers. Access is scoped to the signed-in fleet owner; the renderer never
// picks the owner.
function runFleet<T>(action: (ownerId: number) => FleetResult<T>): FleetResult<T> {
  const owner = getSession('owner')
  if (!owner) return { ok: false, error: 'not_signed_in' }
  try {
    return action(owner.id)
  } catch (err) {
    log.error('Fleet request failed:', err)
    return { ok: false, error: 'unknown' }
  }
}

async function runFleetAsync<T>(
  action: (ownerId: number) => Promise<FleetResult<T>>
): Promise<FleetResult<T>> {
  const owner = getSession('owner')
  if (!owner) return { ok: false, error: 'not_signed_in' }
  try {
    return await action(owner.id)
  } catch (err) {
    log.error('Fleet request failed:', err)
    return { ok: false, error: 'unknown' }
  }
}

function registerFleetHandlers(): void {
  initDb()

  ipcMain.handle('fleet:list-vehicles', () =>
    runFleet((ownerId) => ({ ok: true, data: listVehicles(ownerId) }))
  )
  ipcMain.handle('fleet:add-vehicle', (_event, input: VehicleInput) =>
    runFleet((ownerId) => addVehicle(ownerId, input))
  )
  ipcMain.handle('fleet:update-vehicle', (_event, id: number, input: VehicleInput) =>
    runFleet((ownerId) => updateVehicle(ownerId, id, input))
  )
  ipcMain.handle('fleet:delete-vehicle', (_event, id: number) =>
    runFleet((ownerId) => deleteVehicle(ownerId, id))
  )

  ipcMain.handle('fleet:list-drivers', () =>
    runFleet((ownerId) => ({ ok: true, data: listDrivers(ownerId) }))
  )
  ipcMain.handle('fleet:add-driver', (_event, input: DriverInput) =>
    runFleet((ownerId) => addDriver(ownerId, input))
  )
  ipcMain.handle('fleet:update-driver', (_event, id: number, input: DriverInput) =>
    runFleet((ownerId) => updateDriver(ownerId, id, input))
  )
  ipcMain.handle('fleet:delete-driver', (_event, id: number) =>
    runFleet((ownerId) => deleteDriver(ownerId, id))
  )

  ipcMain.handle('trips:get-reference-data', () =>
    runFleet(() => ({ ok: true, data: getReferenceData() }))
  )
  ipcMain.handle('trips:list', () =>
    runFleet((ownerId) => ({ ok: true, data: listTrips(ownerId) }))
  )
  ipcMain.handle('trips:create', (_event, input: TripInput) =>
    runFleet((ownerId) => createTrip(ownerId, input))
  )
  ipcMain.handle('trips:update', (_event, id: number, input: TripInput) =>
    runFleet((ownerId) => updateTrip(ownerId, id, input))
  )
  ipcMain.handle('trips:delete', (_event, id: number) =>
    runFleet((ownerId) => deleteTrip(ownerId, id))
  )

  ipcMain.handle('billing:get-trip', (_event, manifestId: number) =>
    runFleetAsync((ownerId) => getTripDetails(ownerId, manifestId))
  )
  ipcMain.handle('billing:generate', (_event, manifestId: number) =>
    runFleetAsync((ownerId) => generateBill(ownerId, manifestId))
  )
  ipcMain.handle('billing:refresh', (_event, manifestId: number) =>
    runFleetAsync((ownerId) => refreshBillStatus(ownerId, manifestId))
  )
  ipcMain.handle('billing:simulate-payment', (_event, manifestId: number) =>
    runFleet((ownerId) => simulatePayment(ownerId, manifestId))
  )

  // Saves the page as a PDF; the certificate's print styles hide everything else
  ipcMain.handle('certificates:save-pdf', (event, fileName: unknown) =>
    runFleetAsync(async () => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const defaultPath =
        typeof fileName === 'string' && /^[\w.-]+$/.test(fileName)
          ? `${fileName}.pdf`
          : 'certificate.pdf'
      const options = { defaultPath, filters: [{ name: 'PDF', extensions: ['pdf'] }] }
      const { canceled, filePath } = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)
      if (canceled || !filePath) return { ok: true, data: { saved: false } }
      const pdf = await event.sender.printToPDF({ pageSize: 'A4', printBackground: true })
      await writeFile(filePath, pdf)
      return { ok: true, data: { saved: true } }
    })
  )
}

// Government panel handlers; they need the government session, and see every owner's data
async function runGovt<T>(
  action: () => FleetResult<T> | Promise<FleetResult<T>>
): Promise<FleetResult<T>> {
  if (!getSession('govt')) return { ok: false, error: 'not_signed_in' }
  try {
    return await action()
  } catch (err) {
    log.error('Government request failed:', err)
    return { ok: false, error: 'unknown' }
  }
}

function registerGovtHandlers(): void {
  // Cities and rates, for labelling routes
  ipcMain.handle('govt:get-reference-data', () =>
    runGovt(() => ({ ok: true, data: getReferenceData() }))
  )
  ipcMain.handle('govt:dashboard', (_event, period: unknown) =>
    runGovt(() =>
      isDashboardPeriod(period)
        ? { ok: true, data: getDashboard(period) }
        : { ok: false, error: 'missing_fields' }
    )
  )
  ipcMain.handle('govt:get-tax-settings', () =>
    runGovt(() => ({ ok: true, data: getTaxSettingsView() }))
  )
  ipcMain.handle('govt:update-tax-rates', (_event, input: TaxRatesInput) =>
    runGovt(() => {
      // runGovt has checked the session; the change is logged under this user
      const user = getSession('govt')
      return user ? updateTaxRates(user.id, input) : { ok: false, error: 'not_signed_in' }
    })
  )
  ipcMain.handle('govt:regenerate-demo', () =>
    runGovt(async () => {
      await regenerateDemoData()
      return { ok: true, data: null }
    })
  )
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
  ipcMain.handle('auth:update-profile', (_event, input: ProfileInput) =>
    runAuth(async () => updateProfile(input))
  )
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
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

  registerFleetHandlers()
  registerGovtHandlers()
  registerAuthHandlers()
  configureAutoUpdater()
  // Before the window opens, so the first dashboard load already has data
  try {
    await ensureDemoData()
  } catch (err) {
    log.error('Seeding demo data failed:', err)
  }
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
