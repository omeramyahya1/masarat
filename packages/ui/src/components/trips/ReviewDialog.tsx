import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Flag, LoaderCircle, ShieldX } from 'lucide-react'
import type { TripDetails } from '@masarat/shared/billing'
import type { FleetErrorCode, FleetResult } from '@masarat/shared/fleet'
import { MAX_REVIEW_NOTE_LENGTH, REPORT_REASONS, type ReportReason } from '@masarat/shared/reviews'
import { useFormat } from '../../lib/format'
import { useMountedRef } from '../../lib/useMountedRef'
import { FieldLabel, FormAlert, SelectField } from '../form/fields'
import Modal from '../ui/Modal'

// What the dialog does: file a report, dismiss one, revoke the clearance, or cancel the trip
export type ReviewDialogKind = 'report' | 'dismiss' | 'revoke' | 'cancel'

// A reason (except to dismiss) and a note, then the action. Revoking and cancelling are final and
// their note is shown to the company, so the dialog says so.
function ReviewDialog({
  kind,
  tripId,
  defaultReason,
  onSubmit,
  onDone,
  onClose
}: {
  kind: ReviewDialogKind
  tripId: number
  defaultReason?: ReportReason
  onSubmit: (input: { reason: ReportReason; note: string }) => Promise<FleetResult<TripDetails>>
  onDone: (details: TripDetails) => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const titleId = useId()
  const noteId = useId()
  const mounted = useMountedRef()
  const [reason, setReason] = useState<ReportReason | ''>(defaultReason ?? '')
  const [note, setNote] = useState('')
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [pending, setPending] = useState(false)
  const withReason = kind !== 'dismiss'
  const final = kind === 'revoke' || kind === 'cancel'
  const ready = note.trim().length > 0 && (!withReason || reason !== '')

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!ready) return
    setPending(true)
    setError(null)
    try {
      const result = await onSubmit({ reason: reason || 'other', note: note.trim() })
      if (result.ok) return onDone(result.data)
      if (mounted.current) setError(result.error)
    } catch {
      if (mounted.current) setError('unknown')
    }
    if (mounted.current) setPending(false)
  }

  const Icon = final ? ShieldX : Flag
  return (
    <Modal labelledBy={titleId} onClose={() => !pending && onClose()}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div
          className={`flex size-10 items-center justify-center rounded-lg ${
            final ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          <Icon size={20} />
        </div>
        <div>
          <h2 id={titleId} className="text-base font-semibold">
            {t(`review.dialog.${kind}.title`, { id: format.number(tripId) })}
          </h2>
          <p className="mt-1 text-sm text-stone-600">{t(`review.dialog.${kind}.body`)}</p>
        </div>
        {withReason && (
          <SelectField
            label={t('review.fields.reason')}
            value={reason}
            placeholder={t('review.fields.reason')}
            options={REPORT_REASONS.map((r) => ({ value: r, label: t(`review.reasons.${r}`) }))}
            onChange={(e) => setReason(e.target.value as ReportReason)}
            required
          />
        )}
        <div className="flex flex-col gap-1.5">
          <FieldLabel htmlFor={noteId} label={t('review.fields.note')} />
          <textarea
            id={noteId}
            className="input min-h-24"
            dir="auto"
            value={note}
            maxLength={MAX_REVIEW_NOTE_LENGTH}
            onChange={(e) => setNote(e.target.value)}
            required
          />
          <p className="field-hint">
            {t(final ? 'review.fields.companyNoteHint' : 'review.fields.noteHint')}
          </p>
        </div>
        {error && <FormAlert message={t(`fleet.errors.${error}`)} />}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={pending}
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className={`btn btn-sm ${final ? 'btn-danger' : 'btn-primary'}`}
            disabled={pending || !ready}
          >
            {pending && <LoaderCircle size={16} className="animate-spin" />}
            {t(`review.dialog.${kind}.confirm`)}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default ReviewDialog
