import { useEffect, useState } from 'react'
import type { UpdateProgress, UpdateStatus } from '../../../preload'

function UpdateNotification(): React.JSX.Element | null {
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

  // Show only when downloading or ready to install
  if (status === 'downloading') {
    return (
      <div className="update-banner">
        <div className="update-content">
          <span className="update-spinner" />
          <span>Downloading update... {progress}%</span>
        </div>
      </div>
    )
  }

  if (status === 'downloaded') {
    return (
      <div className="update-banner">
        <div className="update-content">
          <span className="update-icon">⚡</span>
          <div>
            <div className="update-title">Update Ready</div>
            <div className="update-desc">
              {version ? `Version ${version}` : 'A new version'} is ready to install.
            </div>
          </div>
        </div>
        <div className="update-actions">
          <button
            type="button"
            className="update-btn update-btn-primary"
            onClick={() => window.api.updater.quitAndInstall()}
          >
            Restart Now
          </button>
          <button
            type="button"
            className="update-btn update-btn-secondary"
            onClick={() => setDismissed(true)}
          >
            Later
          </button>
        </div>
      </div>
    )
  }

  return null
}

export default UpdateNotification
