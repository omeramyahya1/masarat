import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Download, LoaderCircle, X } from 'lucide-react'
import type { FleetErrorCode, FleetResult, TripDocumentRecord } from '@masarat/shared/fleet'
import type { DownloadedFile } from '@masarat/api-client'
import { useMountedRef } from '../../lib/useMountedRef'
import { FormAlert } from '../form/fields'
import Modal from '../ui/Modal'

interface Loaded {
  url: string
  fileName: string
  type: string
}

// A trip's attachments, previewed in the page: PDFs in the browser's own viewer, images as they
// are. Previous / next (and the arrow keys) go through the trip's documents without closing.
// Files come from the API as blobs, so the API never has to allow being framed.
function DocumentPreview({
  documents,
  startIndex,
  load,
  onClose
}: {
  documents: readonly TripDocumentRecord[]
  startIndex: number
  load: (documentId: number) => Promise<FleetResult<DownloadedFile>>
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const mounted = useMountedRef()
  const [index, setIndex] = useState(startIndex)
  const [files, setFiles] = useState<Record<number, Loaded>>({})
  const [errors, setErrors] = useState<Record<number, FleetErrorCode>>({})
  // Every object URL made, revoked when the preview closes
  const urls = useRef<string[]>([])

  const document = documents[index]
  const file = document ? files[document.id] : undefined
  const error = document ? errors[document.id] : undefined

  useEffect(() => {
    if (!document || files[document.id] || errors[document.id]) return
    const id = document.id
    load(id)
      .then((result) => {
        if (!mounted.current) return
        if (!result.ok) return setErrors((e) => ({ ...e, [id]: result.error }))
        const url = URL.createObjectURL(result.data.blob)
        urls.current.push(url)
        setFiles((f) => ({
          ...f,
          [id]: { url, fileName: result.data.fileName, type: result.data.blob.type }
        }))
      })
      .catch(() => mounted.current && setErrors((e) => ({ ...e, [id]: 'unknown' })))
  }, [document, files, errors, load, mounted])

  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), [])

  const go = useCallback(
    (step: number) => setIndex((i) => Math.min(documents.length - 1, Math.max(0, i + step))),
    [documents.length]
  )

  // Arrow keys follow the reading direction: in Arabic, left is "next"
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const forward = (e.key === 'ArrowRight') !== (i18n.dir() === 'rtl')
      go(forward ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, i18n])

  if (!document) return <></>
  return (
    <Modal labelledBy={titleId} onClose={onClose} className="flex h-[90vh] max-w-5xl flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold">
            {t(`documentTypes.${document.docType}`)}
          </h2>
          <p className="truncate text-xs text-stone-500" dir="auto">
            {document.fileName}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {documents.length > 1 && (
            <>
              <button
                type="button"
                className="icon-btn"
                aria-label={t('trips.documents.previous')}
                title={t('trips.documents.previous')}
                disabled={index === 0}
                onClick={() => go(-1)}
              >
                <ChevronLeft size={18} className="rtl:-scale-x-100" />
              </button>
              <span className="text-sm text-stone-600 tabular-nums">
                {t('trips.documents.position', { n: index + 1, total: documents.length })}
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label={t('trips.documents.next')}
                title={t('trips.documents.next')}
                disabled={index === documents.length - 1}
                onClick={() => go(1)}
              >
                <ChevronRight size={18} className="rtl:-scale-x-100" />
              </button>
            </>
          )}
          {file && (
            <a href={file.url} download={file.fileName} className="btn btn-secondary btn-sm">
              <Download size={14} />
              {t('trips.documents.download')}
            </a>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label={t('certificate.close')}
            title={t('certificate.close')}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg border border-stone-200 bg-stone-100">
        {error ? (
          <div className="p-6">
            <FormAlert message={t(`fleet.errors.${error}`)} />
          </div>
        ) : !file ? (
          <LoaderCircle size={28} className="animate-spin text-brand-700" />
        ) : file.type === 'application/pdf' ? (
          <iframe
            key={file.url}
            src={file.url}
            title={document.fileName}
            className="h-full w-full"
          />
        ) : (
          <img
            src={file.url}
            alt={document.fileName}
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>
    </Modal>
  )
}

export default DocumentPreview
