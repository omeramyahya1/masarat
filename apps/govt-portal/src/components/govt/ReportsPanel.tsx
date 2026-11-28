import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Flag, LoaderCircle } from 'lucide-react'
import type { CityRecord, FleetErrorCode } from '@masarat/shared/fleet'
import { DEFAULT_PAGE_SIZE, type PageSize } from '@masarat/shared/paging'
import { REPORT_STATUSES, type ReportStatus } from '@masarat/shared/reviews'
import { useFormat } from '@masarat/ui/lib/format'
import { errorCode, queryKeys, unwrap } from '@masarat/ui/lib/query'
import { useSessionState } from '@masarat/ui/lib/useSessionState'
import { FormAlert } from '@masarat/ui/components/form/fields'
import PlateBadge from '@masarat/ui/components/fleet/PlateBadge'
import Pagination from '@masarat/ui/components/ui/Pagination'
import { RouteLabel, Segmented } from './parts'
import { api } from '@masarat/api-client'

type StatusFilter = ReportStatus | 'all'

const STATUS_STYLES: Record<ReportStatus, string> = {
  open: 'bg-amber-50 text-amber-800 ring-amber-200',
  revoked: 'bg-red-50 text-red-800 ring-red-200',
  dismissed: 'bg-stone-100 text-stone-700 ring-stone-200'
}

// Government portal → Reports (supervisors and the admin): the reports on issued clearances, newest
// first, open ones by default. Opening one shows the trip read-only, where the supervisor dismisses
// the report or revokes the clearance (ReviewPanel).
function ReportsPanel({
  cities,
  onOpenTrip
}: {
  cities: readonly CityRecord[]
  onOpenTrip: (manifestId: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  // Kept for the session, like the dashboard's filters
  const [status, setStatus] = useSessionState<StatusFilter>('govt.reports.status', 'open')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE)
  const request = { status: status === 'all' ? undefined : status, page, pageSize }
  // Each page is cached (lib/query.ts) and refreshed after a review action (reviewChanged)
  const reports = useQuery({
    queryKey: queryKeys.reports(request),
    queryFn: () => unwrap(api.govt.reports.list(request)),
    placeholderData: keepPreviousData
  })
  const data = reports.data ?? null
  const error = errorCode<FleetErrorCode>(reports.error)

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">{t('review.section.title')}</h2>
          <p className="max-w-2xl text-sm text-stone-500">{t('review.section.subtitle')}</p>
        </div>
        <Segmented
          label={t('review.section.filter')}
          options={[
            ...REPORT_STATUSES.map((s) => ({ value: s, label: t(`review.reportStatuses.${s}`) })),
            { value: 'all' as const, label: t('review.section.all') }
          ]}
          value={status}
          onChange={(next) => {
            setStatus(next)
            setPage(1)
          }}
        />
      </div>

      {error ? (
        <FormAlert message={t(`fleet.errors.${error}`)} />
      ) : !data ? (
        <div className="flex justify-center py-16 text-stone-400">
          <LoaderCircle className="animate-spin" />
        </div>
      ) : data.total === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <Flag size={28} className="text-stone-400" />
          <p className="max-w-sm text-sm text-stone-500">{t('review.section.empty')}</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-stone-500">
            {t('review.section.count', { count: format.number(data.total) })}
          </p>
          <div className="card overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('review.section.columns.trip')}</th>
                  <th>{t('review.section.columns.company')}</th>
                  <th>{t('review.section.columns.vehicle')}</th>
                  <th>{t('review.section.columns.route')}</th>
                  <th>{t('review.section.columns.reason')}</th>
                  <th>{t('review.section.columns.reportedBy')}</th>
                  <th>{t('review.section.columns.status')}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((report) => (
                  <tr
                    key={report.id}
                    className="cursor-pointer hover:bg-stone-50"
                    onClick={() => onOpenTrip(report.manifestId)}
                  >
                    <td className="whitespace-nowrap">
                      {/* Keyboard access to the row; the row itself handles mouse clicks */}
                      <button
                        type="button"
                        className="text-start hover:underline"
                        aria-label={t('review.section.openTrip', {
                          id: format.number(report.manifestId)
                        })}
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenTrip(report.manifestId)
                        }}
                      >
                        <div className="font-medium text-stone-900">
                          #{format.number(report.manifestId)} · {format.date(report.departureAt)}
                        </div>
                        {report.manifestNo && (
                          <div dir="ltr" className="font-mono text-[11px] text-stone-400">
                            {report.manifestNo}
                          </div>
                        )}
                      </button>
                    </td>
                    <td>
                      <bdi>{report.companyName}</bdi>
                    </td>
                    <td>
                      <PlateBadge plate={report.plateNumber} />
                    </td>
                    <td>
                      <RouteLabel
                        cities={cities}
                        originId={report.originCityId}
                        destinationId={report.destinationCityId}
                      />
                    </td>
                    <td className="max-w-xs">
                      <div className="text-stone-900">{t(`review.reasons.${report.reason}`)}</div>
                      <bdi className="line-clamp-2 text-xs text-stone-500">{report.note}</bdi>
                    </td>
                    <td className="whitespace-nowrap">
                      <bdi className="block">{report.reportedBy}</bdi>
                      <span className="text-xs text-stone-500">
                        {format.dateTime(report.reportedAt)}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ${STATUS_STYLES[report.status]}`}
                      >
                        {t(`review.reportStatuses.${report.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPage={setPage}
            onPageSize={(size) => {
              setPageSize(size)
              setPage(1)
            }}
          />
        </>
      )}
    </section>
  )
}

export default ReportsPanel
