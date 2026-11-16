import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { DownloadCloud, LoaderCircle } from 'lucide-react'
import type { UpdateProgress, UpdateStatus } from '../../../preload'

function UpdateNotification(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [status, setStatus] = useState<UpdateStatus['status'] | 'idle'>('idle')
  const [version, setVersion] = useState<string | undefined>()
  const [progress, setProgress] = useState<number>(0)
  const [dismissed, setDismissed] = useState<boolean>(false)

  useEffect(() => {
    // If running in browser or updater api not available
    if (!window.api?.updater) return

    const unsubStatus = window.api.updater.onStatusChange((info: UpdateStatus) => {
      setStatus(info.status)
      if (info.version) setVersion(info.version)
      if (info.status === 'downloaded') {
        setDismissed(false) // Un-dismiss when update finishes downloading
      }
    })

    const unsubProgress = window.api.updater.onProgress((prog: UpdateProgress) => {
      setProgress(prog.percent)
    })

    return (): void => {
      unsubStatus?.()
      unsubProgress?.()
    }
  }, [])

  if (dismissed) return null

  const banner = 'card fixed end-6 bottom-6 z-50 flex items-center gap-4 px-4 py-3 shadow-lg'

  // Show only when downloading or ready to install
  if (status === 'downloading') {
    return (
      <div className={banner}>
        <LoaderCircle size={18} className="animate-spin text-brand-700" />
        <span className="text-sm">{t('updater.downloading', { percent: progress })}</span>
      </div>
    )
  }

  if (status === 'downloaded') {
    return (
      <div className={banner}>
        <DownloadCloud size={20} className="text-brand-700" />
        <div>
          <div className="text-sm font-semibold">{t('updater.readyTitle')}</div>
          <div className="text-xs text-stone-500">{t('updater.readyBody', { version })}</div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => window.api.updater.quitAndInstall()}
          >
            {t('updater.restartNow')}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setDismissed(true)}
          >
            {t('updater.later')}
          </button>
        </div>
      </div>
    )
  }

  return null
}

export default UpdateNotification
