import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, LoaderCircle, Paperclip, X } from 'lucide-react'
import {
  DOCUMENT_EXTENSIONS,
  documentTypesFor,
  type DocumentType,
  type TripKind
} from '@masarat/shared/fleet'
import { useFormat } from '@masarat/ui/lib/format'

// An attachment as the form holds it: saved with the trip (id) or uploaded and staged (token)
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
  // The document being uploaded, if any
  busy: DocumentType | null
  onAttach: (docType: DocumentType, file: File) => void
  onRemove: (docType: DocumentType) => void
}

// One slot per document the trip's type needs: attach a file, or remove it to attach another
function DocumentsField({
  tripKind,
  value,
  busy,
  onAttach,
  onRemove
}: DocumentsFieldProps): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  // One hidden file input, opened for the slot whose Attach was clicked
  const input = useRef<HTMLInputElement>(null)
  const target = useRef<DocumentType | null>(null)

  const choose = (docType: DocumentType): void => {
    target.current = docType
    input.current?.click()
  }

  return (
    <ul className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        hidden
        accept={DOCUMENT_EXTENSIONS.map((e) => `.${e}`).join(',')}
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Cleared so choosing the same file again still fires
          e.target.value = ''
          if (file && target.current) onAttach(target.current, file)
        }}
      />
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
            ) : (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy !== null}
                onClick={() => choose(docType)}
              >
                <Paperclip size={16} />
                {working ? t('trips.documents.uploading') : t('trips.documents.attach')}
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export default DocumentsField
