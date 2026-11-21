import { useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Download, LoaderCircle } from 'lucide-react'
import type { FleetErrorCode, TripReferenceData } from '@masarat/shared/fleet'
import type { TripDetails } from '@masarat/shared/billing'
import { createFormatters } from '../../lib/format'
import { useMountedRef } from '../../lib/useMountedRef'
import { FormAlert } from '../form/fields'
import Modal from '../ui/Modal'
import ManifestPage from './ManifestPage'
import ReceiptPage from './ReceiptPage'
import { api } from '@masarat/api-client'

interface CertificateModalProps {
  details: TripDetails
  reference: TripReferenceData
  onClose: () => void
}

// The documents issued for a paid trip: the electronic payment receipt, then the authorized
// manifest. They are official documents, so they are always in Arabic whatever the UI language;
// the surrounding dialog controls follow the UI language.
function CertificateModal({
  details,
  reference,
  onClose
}: CertificateModalProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const mounted = useMountedRef()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const ar = useMemo(() => i18n.getFixedT('ar'), [i18n])
  const fa = useMemo(() => createFormatters(true, ar), [ar])

  const { payment, certificate } = details
  if (!payment || !certificate) return null

  const savePdf = async (): Promise<void> => {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const result = await api.certificates.savePdf(certificate.certificateNo)
      if (!mounted.current) return
      if (!result.ok) setError(result.error)
      else setSaved(result.data.saved)
    } catch {
      if (mounted.current) setError('unknown')
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  // printToPDF captures the live page, so the certificate has to stay open until it's saved
  const close = (): void => {
    if (!saving) onClose()
  }

  // Rendered straight into <body> so the print styles can drop the rest of the app from layout
  return createPortal(
    <Modal labelledBy={titleId} onClose={close} className="print-dialog max-w-[calc(190mm+4rem)]">
      <div className="no-print mb-4 flex items-center justify-between gap-4">
        <h2 id={titleId} className="text-lg font-semibold">
          {t('certificate.dialogTitle')}
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={saving}
            onClick={close}
          >
            {t('certificate.close')}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={saving}
            onClick={savePdf}
          >
            {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
            {t('certificate.download')}
          </button>
        </div>
      </div>
      {(error || saved) && (
        <div className="no-print mb-4">
          {error ? (
            <FormAlert message={t(`fleet.errors.${error}`)} />
          ) : (
            <FormAlert tone="success" message={t('certificate.saved')} />
          )}
        </div>
      )}

      {/* Every page of both documents is a sheet; printing puts each on its own A4 page */}
      <div className="print-sheets flex flex-col gap-6">
        <ReceiptPage
          details={details}
          payment={payment}
          certificate={certificate}
          reference={reference}
          ar={ar}
          fa={fa}
        />
        <ManifestPage
          details={details}
          certificate={certificate}
          reference={reference}
          ar={ar}
          fa={fa}
        />
      </div>
    </Modal>,
    document.body
  )
}

export default CertificateModal
