import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { FileDown, LoaderCircle } from 'lucide-react'
import {
  BREAKDOWNS,
  BREAKDOWN_SORTS,
  BUCKET_SIZES,
  type AnalyticsFilters,
  type Breakdown,
  type BreakdownSort,
  type BucketSize,
  type DashboardView
} from '@masarat/shared/analytics'
import type { DashboardData } from '@masarat/shared/dashboard'
import type { CityRecord, FleetErrorCode } from '@masarat/shared/fleet'
import { useMountedRef } from '@masarat/ui/lib/useMountedRef'
import { FormAlert } from '@masarat/ui/components/form/fields'
import Modal from '@masarat/ui/components/ui/Modal'
import AnalyticsFilterFields from './AnalyticsFilterFields'
import DataExportFields from './DataExportFields'
import ReportModal from './ReportModal'
import { REPORT_SECTIONS, type ReportSection } from './reportSections'
import { Segmented } from './parts'
import { errorCode } from '@masarat/ui/lib/query'
import { loadDashboard } from './dashboardData'

type Tab = 'report' | 'data'

function Labeled({
  label,
  children
}: {
  label: string
  children: (id: string) => ReactNode
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-stone-500">
        {label}
      </label>
      {children(id)}
    </div>
  )
}

// The government's exports: the dashboard as a PDF report, or the raw data as CSV / Excel. Both
// start from the dashboard's current filters, which can be changed here without touching it.
function ExportDialog({
  initialFilters,
  initialView,
  cities,
  onClose
}: {
  initialFilters: AnalyticsFilters
  initialView: DashboardView
  cities: readonly CityRecord[]
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const titleId = useId()
  const mounted = useMountedRef()
  const [tab, setTab] = useState<Tab>('report')
  const [filters, setFilters] = useState<AnalyticsFilters>(initialFilters)
  const [view, setView] = useState<DashboardView>(initialView)
  const [sections, setSections] = useState<ReadonlySet<ReportSection>>(
    () => new Set(REPORT_SECTIONS)
  )
  const [report, setReport] = useState<DashboardData | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<FleetErrorCode | null>(null)

  const toggleSection = (section: ReportSection): void =>
    setSections((current) => {
      const next = new Set(current)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })

  const previewReport = async (): Promise<void> => {
    setPending(true)
    setError(null)
    try {
      // The same figures as the dashboard: the nightly aggregates and today, added together
      const data = await loadDashboard(filters, view)
      if (mounted.current) setReport(data)
    } catch (err) {
      if (mounted.current) setError(errorCode<FleetErrorCode>(err) ?? 'unknown')
    } finally {
      if (mounted.current) setPending(false)
    }
  }

  return (
    <Modal labelledBy={titleId} onClose={onClose} className="max-w-4xl">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
              <FileDown size={20} />
            </div>
            <div>
              <h2 id={titleId} className="text-base font-semibold">
                {t('govt.export.title')}
              </h2>
              <p className="text-sm text-stone-500">{t('govt.export.subtitle')}</p>
            </div>
          </div>
          <Segmented
            label={t('govt.export.kind')}
            options={[
              { value: 'report', label: t('govt.export.tabs.report') },
              { value: 'data', label: t('govt.export.tabs.data') }
            ]}
            value={tab}
            onChange={(value) => {
              setTab(value)
              setError(null)
            }}
          />
        </div>

        <fieldset className="flex flex-col gap-3 rounded-lg border border-stone-200 p-4">
          <legend className="px-1 text-sm font-semibold text-stone-800">
            {t('govt.export.parameters')}
          </legend>
          <AnalyticsFilterFields filters={filters} cities={cities} onChange={setFilters} />
        </fieldset>

        {error && <FormAlert message={t(`fleet.errors.${error}`)} />}

        {tab === 'report' ? (
          <>
            <fieldset className="flex flex-col gap-3 rounded-lg border border-stone-200 p-4">
              <legend className="px-1 text-sm font-semibold text-stone-800">
                {t('govt.export.reportOptions')}
              </legend>
              <div className="grid grid-cols-3 gap-3">
                <Labeled label={t('govt.dashboard.revenue.groupBy')}>
                  {(id) => (
                    <select
                      id={id}
                      className="input py-1.5 text-sm"
                      value={view.bucket ?? ''}
                      onChange={(e) =>
                        setView({ ...view, bucket: (e.target.value || null) as BucketSize | null })
                      }
                    >
                      <option value="">{t('govt.export.automatic')}</option>
                      {BUCKET_SIZES.map((b) => (
                        <option key={b} value={b}>
                          {t(`govt.dashboard.revenue.buckets.${b}`)}
                        </option>
                      ))}
                    </select>
                  )}
                </Labeled>
                <Labeled label={t('govt.dashboard.breakdown.groupBy')}>
                  {(id) => (
                    <select
                      id={id}
                      className="input py-1.5 text-sm"
                      value={view.breakdown}
                      onChange={(e) => setView({ ...view, breakdown: e.target.value as Breakdown })}
                    >
                      {BREAKDOWNS.map((b) => (
                        <option key={b} value={b}>
                          {t(`govt.dashboard.breakdown.by.${b}`)}
                        </option>
                      ))}
                    </select>
                  )}
                </Labeled>
                <Labeled label={t('govt.dashboard.breakdown.sortBy')}>
                  {(id) => (
                    <select
                      id={id}
                      className="input py-1.5 text-sm"
                      value={view.sort}
                      onChange={(e) => setView({ ...view, sort: e.target.value as BreakdownSort })}
                    >
                      {BREAKDOWN_SORTS.map((s) => (
                        <option key={s} value={s}>
                          {t(`govt.dashboard.breakdown.sort.${s}`)}
                        </option>
                      ))}
                    </select>
                  )}
                </Labeled>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-stone-500">
                  {t('govt.export.sections')}
                </span>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {REPORT_SECTIONS.map((section) => (
                    <label key={section} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-brand-700"
                        checked={sections.has(section)}
                        onChange={() => toggleSection(section)}
                      />
                      {t(`govt.export.sectionNames.${section}`)}
                    </label>
                  ))}
                </div>
              </div>
              <p className="text-xs text-stone-500">{t('govt.export.reportNote')}</p>
            </fieldset>
            <div className="flex justify-end gap-2 border-t border-stone-200 pt-4">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={previewReport}
              >
                {pending && <LoaderCircle size={16} className="animate-spin" />}
                {t('govt.export.previewReport')}
              </button>
            </div>
          </>
        ) : (
          <DataExportFields filters={filters} onClose={onClose} />
        )}
      </div>

      {report && (
        <ReportModal
          data={report}
          view={view}
          sections={sections}
          cities={cities}
          onClose={() => setReport(null)}
        />
      )}
    </Modal>
  )
}

export default ExportDialog
