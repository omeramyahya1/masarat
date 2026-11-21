import { useTranslation } from 'react-i18next'
import { FileText, LoaderCircle, Paperclip, ScanText, X } from 'lucide-react'
import { documentTypesFor, type DocumentType, type TripKind } from '../../../../shared/fleet'
import { useFormat } from '../../lib/format'

// An attachment as the form holds it: saved with the trip (id) or picked and staged (token)
export interface DocumentDraft {
  docType: DocumentType
  id?: number
  token?: string
  fileName: string
  size: number
}

interface DocumentsFieldProps {
  tripKind: TripKind
  value: readonly DocumentDraft[]
  // The document being picked or scanned, if any
  busy: DocumentType | null
  // Scanning needs the vehicle (its unit decides what cargo can be read)
  canScan: boolean
  onAttach: (docType: DocumentType) => void
  onRemove: (docType: DocumentType) => void
  onScan: (docType: DocumentType) => void
}

// One slot per document the trip's type needs: attach a file, then scan it to fill in the form
function DocumentsField({
  tripKind,
  value,
  busy,
  canScan,
  onAttach,
  onRemove,
  onScan
}: DocumentsFieldProps): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()

  return (
    <ul className="flex flex-col gap-2">
      {documentTypesFor(tripKind).map((docType) => {
        const document = value.find((d) => d.docType === docType)
        const working = busy === docType
        return (
          <li
            key={docType}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 px-3 py-2.5"
          >
            <FileText size={18} className="shrink-0 text-stone-400" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium text-stone-800">
                {t(`documentTypes.${docType}`)}
              </span>
              {document ? (
                <span className="truncate text-xs text-stone-500" dir="auto">
                  {document.fileName} · {format.fileSize(document.size)}
                </span>
              ) : (
                <span className="text-xs text-stone-400">{t('trips.documents.none')}</span>
              )}
            </div>
            {working && <LoaderCircle size={16} className="animate-spin text-brand-700" />}
            {document ? (
              <>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy !== null || !canScan}
                  title={canScan ? undefined : t('trips.documents.chooseVehicle')}
                  onClick={() => onScan(docType)}
                >
                  <ScanText size={16} />
                  {working ? t('trips.documents.scanning') : t('trips.documents.scan')}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={busy !== null}
                  aria-label={t('trips.documents.removeOf', {
                    name: t(`documentTypes.${docType}`)
                  })}
                  title={t('trips.documents.remove')}
                  onClick={() => onRemove(docType)}
                >
                  <X size={16} />
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy !== null}
                onClick={() => onAttach(docType)}
              >
                <Paperclip size={16} />
                {t('trips.documents.attach')}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default DocumentsField
