import { useId, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Printer } from 'lucide-react'
import type { TripReferenceData } from '@masarat/shared/fleet'
import type { TripDetails } from '@masarat/shared/billing'
import { createFormatters } from '../../lib/format'
import { printDocument } from '../../lib/printDocument'
import Modal from '../ui/Modal'
import ManifestPage from './ManifestPage'
import PassengerManifestPage from './PassengerManifestPage'
import ReceiptPage from './ReceiptPage'

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
  const ar = useMemo(() => i18n.getFixedT('ar'), [i18n])
  const fa = useMemo(() => createFormatters(true, ar), [ar])

  const { payment, certificate } = details
  if (!payment || !certificate) return null

  // Rendered straight into <body> so the print styles can drop the rest of the app from layout
  return createPortal(
    <Modal labelledBy={titleId} onClose={onClose} className="print-dialog max-w-[calc(190mm+4rem)]">
      <div className="no-print mb-4 flex items-center justify-between gap-4">
        <h2 id={titleId} className="text-lg font-semibold">
          {t('certificate.dialogTitle')}
        </h2>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            {t('certificate.close')}
          </button>
          {/* The browser's print dialog: "Save as PDF" there saves the receipt and manifest */}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => printDocument(certificate.certificateNo)}
          >
            <Printer size={16} />
            {t('certificate.download')}
          </button>
        </div>
      </div>

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
        {/* A bus trip's manifest lists its passengers; a truck's its cargo */}
        {details.trip.category === 'passenger' ? (
          <PassengerManifestPage
            details={details}
            certificate={certificate}
            reference={reference}
            ar={ar}
            fa={fa}
          />
        ) : (
          <ManifestPage
            details={details}
            certificate={certificate}
            reference={reference}
            ar={ar}
            fa={fa}
          />
        )}
      </div>
    </Modal>,
    document.body
  )
}

export default CertificateModal
