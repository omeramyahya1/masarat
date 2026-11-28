import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Ban, Flag, ShieldAlert, ShieldX } from 'lucide-react'
import type { TripDetails } from '@masarat/shared/billing'
import type { ReportRecord } from '@masarat/shared/reviews'
import { useCan } from '../../lib/account'
import { useFormat } from '../../lib/format'
import { reviewChanged } from '../../lib/query'
import ReviewDialog, { type ReviewDialogKind } from './ReviewDialog'
import { api } from '@masarat/api-client'

const REPORT_STATUS_STYLES: Record<ReportRecord['status'], string> = {
  open: 'bg-amber-50 text-amber-800 ring-amber-200',
  revoked: 'bg-red-50 text-red-800 ring-red-200',
  dismissed: 'bg-stone-100 text-stone-700 ring-stone-200'
}

// The review of a trip's clearance on its page. Both portals see the supervisor's decision (a
// revoked clearance or a cancelled trip, with the reason and note). The government's read-only view
// also sees the reports and, as its role allows, reports the clearance, dismisses the open report,
// revokes the clearance or cancels a trip whose bill is unpaid.
function ReviewPanel({
  details,
  readOnly,
  onChanged
}: {
  details: TripDetails
  // The government's view
  readOnly: boolean
  // A review action changed the trip
  onChanged: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const format = useFormat()
  const can = useCan()
  const [dialog, setDialog] = useState<ReviewDialogKind | null>(null)
  const { trip, decision, reports, archived } = details
  const open = reports.find((r) => r.status === 'open') ?? null
  const govt = readOnly
  const canReport =
    govt && !archived && can('govt.reports.create') && trip.status === 'certified' && !open
  const canReview = govt && can('govt.reports.review')
  const canCancel = canReview && !archived && trip.status === 'billed'

  if (!decision && reports.length === 0 && !canReport && !canCancel) return null

  const submit: Record<
    ReviewDialogKind,
    (input: {
      reason: ReportRecord['reason']
      note: string
    }) => ReturnType<typeof api.govt.cancelTrip>
  > = {
    report: (input) => api.govt.reports.create({ manifestId: trip.id, ...input }),
    dismiss: ({ note }) => api.govt.reports.dismiss(open!.id, { note }),
    revoke: (input) => api.govt.reports.revoke(open!.id, input),
    cancel: (input) => api.govt.cancelTrip(trip.id, input)
  }

  return (
    <div className="flex flex-col gap-3">
      {decision && (
        <div
          className="flex gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="status"
        >
          {decision.action === 'revoke' ? (
            <ShieldX size={20} className="mt-0.5 shrink-0" />
          ) : (
            <Ban size={20} className="mt-0.5 shrink-0" />
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-semibold">{t(`review.decision.${decision.action}.title`)}</span>
            <span>
              {t(`review.decision.${decision.action}.body`, {
                date: format.dateTime(decision.decidedAt)
              })}
            </span>
            <span>
              <span className="font-medium">{t('review.decision.reason')}: </span>
              {t(`review.reasons.${decision.reason}`)}
            </span>
            <span>
              <span className="font-medium">{t('review.decision.note')}: </span>
              <bdi className="whitespace-pre-line">{decision.note}</bdi>
            </span>
            {decision.decidedBy && (
              <span className="text-xs text-red-800/80">
                {t('review.decision.by', { name: decision.decidedBy })}
              </span>
            )}
          </div>
        </div>
      )}

      {open && (
        <div
          className="flex flex-wrap items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          role="status"
        >
          <ShieldAlert size={20} className="mt-0.5 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-semibold">{t('review.open.title')}</span>
            <span>{t('review.open.body')}</span>
          </div>
          {canReview && !archived && (
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setDialog('dismiss')}
              >
                {t('review.actions.dismiss')}
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => setDialog('revoke')}
              >
                <ShieldX size={16} />
                {t('review.actions.revoke')}
              </button>
            </div>
          )}
        </div>
      )}

      {(canReport || canCancel) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm">
          <span className="text-stone-600">
            {t(canReport ? 'review.actions.reportHint' : 'review.actions.cancelHint')}
          </span>
          {canReport ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setDialog('report')}
            >
              <Flag size={16} />
              {t('review.actions.report')}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => setDialog('cancel')}
            >
              <Ban size={16} />
              {t('review.actions.cancelTrip')}
            </button>
          )}
        </div>
      )}

      {reports.length > 0 && (
        <section className="card p-4" aria-labelledby={`reports-${trip.id}`}>
          <h3 id={`reports-${trip.id}`} className="mb-2 text-sm font-semibold text-stone-800">
            {t('review.history')}
          </h3>
          <ul className="flex flex-col divide-y divide-stone-100">
            {reports.map((report) => (
              <li key={report.id} className="flex flex-col gap-1 py-2.5 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${REPORT_STATUS_STYLES[report.status]}`}
                  >
                    {t(`review.reportStatuses.${report.status}`)}
                  </span>
                  <span className="font-medium text-stone-900">
                    {t(`review.reasons.${report.reason}`)}
                  </span>
                </div>
                <bdi className="whitespace-pre-line text-stone-700">{report.note}</bdi>
                <span className="text-xs text-stone-500">
                  {t('review.reportedBy', {
                    name: report.reportedBy,
                    date: format.dateTime(report.reportedAt)
                  })}
                </span>
                {report.resolvedAt !== null && report.resolvedBy && (
                  <span className="text-xs text-stone-500">
                    {t('review.resolvedBy', {
                      status: t(`review.reportStatuses.${report.status}`),
                      name: report.resolvedBy,
                      date: format.dateTime(report.resolvedAt)
                    })}
                    {report.resolutionNote && (
                      <bdi className="block whitespace-pre-line text-stone-600">
                        {report.resolutionNote}
                      </bdi>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {dialog && (
        <ReviewDialog
          kind={dialog}
          tripId={trip.id}
          defaultReason={dialog === 'revoke' ? open?.reason : undefined}
          onSubmit={submit[dialog]}
          onDone={(next) => {
            setDialog(null)
            void reviewChanged(next)
            onChanged()
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

export default ReviewPanel
