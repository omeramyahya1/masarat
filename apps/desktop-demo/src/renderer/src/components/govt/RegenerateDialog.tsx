import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle } from 'lucide-react'
import type { FleetErrorCode } from '../../../../shared/fleet'
import { useMountedRef } from '../../lib/useMountedRef'
import Modal from '../ui/Modal'

// Demo only: confirms and runs "Regenerate demo data"
function RegenerateDialog({
  onClose,
  onDone
}: {
  onClose: () => void
  // Called once the demo data is rebuilt, or with the error if it failed
  onDone: (error: FleetErrorCode | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const titleId = useId()
  const mounted = useMountedRef()
  const [pending, setPending] = useState(false)

  const regenerate = async (): Promise<void> => {
    setPending(true)
    let error: FleetErrorCode | null = null
    try {
      const result = await window.api.govt.regenerateDemoData()
      if (!result.ok) error = result.error
    } catch {
      error = 'unknown'
    }
    if (mounted.current) setPending(false)
    onDone(error)
  }

  return (
    <Modal labelledBy={titleId} onClose={() => !pending && onClose()}>
      <h2 id={titleId} className="mb-2 text-lg font-semibold">
        {t('govt.dashboard.regenerate.title')}
      </h2>
      <p className="mb-6 text-sm text-stone-600">{t('govt.dashboard.regenerate.body')}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={regenerate}>
          {pending && <LoaderCircle size={16} className="animate-spin" />}
          {t('govt.dashboard.regenerate.confirm')}
        </button>
      </div>
    </Modal>
  )
}

export default RegenerateDialog
