import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CircleAlert,
  CircleCheck,
  Download,
  Info,
  RefreshCw,
  RotateCcw,
  type LucideIcon
} from 'lucide-react'
import type { UpdateStatus } from '../../../preload'

type Status = UpdateStatus['status'] | 'idle'

// Results that show briefly on the button, then fall back to "Check for updates"
const TRANSIENT: readonly Status[] = ['not-available', 'unsupported', 'error']
const TRANSIENT_MS = 5000

const BUTTON_ICONS: Record<Status, LucideIcon> = {
  idle: RefreshCw,
  checking: RefreshCw,
  available: Download,
  downloading: Download,
  downloaded: RotateCcw,
  'not-available': CircleCheck,
  unsupported: Info,
  error: CircleAlert
}

// Checks for a new release on demand. electron-updater downloads it automatically
// (autoDownload), and once it's downloaded we ask the user to restart.
function UpdateControl(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [status, setStatus] = useState<Status>('idle')
  const [version, setVersion] = useState<string>()
  const [progress, setProgress] = useState(0)
  const [dialogOpen, setDialogOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const restartRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!window.api?.updater) return

    const unsubStatus = window.api.updater.onStatusChange((info) => {
      setStatus(info.status)
      if (info.version) setVersion(info.version)
      if (info.status === 'downloaded') setDialogOpen(true)
    })
    // The main process reports download progress separately from status changes
    const unsubProgress = window.api.updater.onProgress((info) => {
      setProgress(info.percent)
      setStatus((current) => (current === 'downloaded' ? current : 'downloading'))
    })

    return (): void => {
      unsubStatus()
      unsubProgress()
    }
  }, [])

  useEffect(() => {
    if (!TRANSIENT.includes(status)) return
    const timer = setTimeout(() => setStatus('idle'), TRANSIENT_MS)
    return (): void => clearTimeout(timer)
  }, [status])

  // Native modal dialog: keeps focus inside, makes the rest of the app inert, and closes on Escape
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (dialogOpen && !dialog.open) {
      dialog.showModal()
      restartRef.current?.focus()
    } else if (!dialogOpen && dialog.open) {
      dialog.close()
    }
  }, [dialogOpen])

  // Fires for both Escape and "Later"; return focus to the button that opened the dialog
  const handleDialogClose = (): void => {
    setDialogOpen(false)
    buttonRef.current?.focus()
  }

  if (!window.api?.updater) return null

  const busy = status === 'checking' || status === 'available' || status === 'downloading'
  const Icon = BUTTON_ICONS[status]

  const handleClick = (): void => {
    if (status === 'downloaded') {
      setDialogOpen(true)
      return
    }
    setStatus('checking')
    window.api.updater.checkForUpdates()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`btn btn-secondary btn-sm ${status === 'downloaded' ? 'border-brand-300 text-brand-800' : ''}`}
        disabled={busy}
        onClick={handleClick}
      >
        <Icon size={16} className={status === 'checking' ? 'animate-spin' : ''} />
        {t(`updater.button.${status}`, { percent: progress })}
      </button>

      <dialog
        ref={dialogRef}
        className="card m-auto w-full max-w-sm p-6 text-stone-900 shadow-xl backdrop:bg-stone-900/40"
        aria-labelledby="update-dialog-title"
        onClose={handleDialogClose}
      >
        <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <Download size={20} />
        </div>
        <h2 id="update-dialog-title" className="text-base font-semibold">
          {t('updater.dialog.title')}
        </h2>
        <p className="mt-1 text-sm text-stone-600">
          {version ? t('updater.dialog.body', { version }) : t('updater.dialog.bodyNoVersion')}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setDialogOpen(false)}
          >
            {t('updater.dialog.later')}
          </button>
          <button
            ref={restartRef}
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => window.api.updater.quitAndInstall()}
          >
            {t('updater.dialog.restart')}
          </button>
        </div>
      </dialog>
    </>
  )
}

export default UpdateControl
