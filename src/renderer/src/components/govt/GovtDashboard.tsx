import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileDown, LoaderCircle, RefreshCw } from 'lucide-react'
import type { CityRecord, FleetErrorCode } from '../../../../shared/fleet'
import type { DashboardData } from '../../../../shared/dashboard'
import {
  DEFAULT_FILTERS,
  DEFAULT_VIEW,
  bucketsFor,
  type AnalyticsFilters,
  type DashboardView,
  type OwnerOption
} from '../../../../shared/analytics'
import { useFormat } from '../../lib/format'
import { useMountedRef } from '../../lib/useMountedRef'
import { FormAlert } from '../form/fields'
import Menu from '../ui/Menu'
import AnalyticsFilterFields from './AnalyticsFilterFields'
import BarList from './BarList'
import BreakdownCard from './BreakdownCard'
import ExportDialog from './ExportDialog'
import KpiGrid from './KpiGrid'
import RecentBills from './RecentBills'
import RegenerateDialog from './RegenerateDialog'
import TripProgress from './TripProgress'
import { Card, Empty, Segmented } from './parts'

// Recharts is large; load it only when the government panel opens
const RevenueChart = lazy(() => import('./RevenueChart'))

// Government landing view: collection totals and activity across every fleet owner
function GovtDashboard({
  onOpenTrip
}: {
  onOpenTrip: (manifestId: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const mounted = useMountedRef()
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS)
  const [view, setView] = useState<DashboardView>(DEFAULT_VIEW)
  const [owners, setOwners] = useState<OwnerOption[]>([])
  // What the main process needs; the breakdown's sort is applied here without asking it again
  const request = useMemo<DashboardView>(
    () => ({ bucket: view.bucket, breakdown: view.breakdown, sort: 'revenue' }),
    [view.bucket, view.breakdown]
  )
  const [data, setData] = useState<DashboardData | null>(null)
  const [cities, setCities] = useState<CityRecord[]>([])
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [exporting, setExporting] = useState(false)
  // City names only label routes; if they fail to load, the next refresh retries them
  const [citiesFailed, setCitiesFailed] = useState(false)
  const [citiesKey, setCitiesKey] = useState(0)

  useEffect(() => {
    window.api.govt
      .listOwners()
      .then((result) => mounted.current && result.ok && setOwners(result.data))
      .catch(() => undefined)
  }, [mounted])

  useEffect(() => {
    window.api.govt
      .getReferenceData()
      .then((result) => {
        if (!mounted.current) return
        if (result.ok) {
          setCities(result.data.cities)
          setCitiesFailed(false)
        } else setCitiesFailed(true)
      })
      .catch(() => mounted.current && setCitiesFailed(true))
  }, [mounted, citiesKey])

  useEffect(() => {
    let current = true
    window.api.govt
      .dashboard(filters, request)
      .then((result) => {
        if (!current) return
        if (result.ok) {
          setData(result.data)
          setError(null)
        } else setError(result.error)
      })
      .catch(() => current && setError('unknown'))
      .finally(() => current && setLoading(false))
    // A newer request (filter change or refresh) supersedes this one
    return (): void => {
      current = false
    }
  }, [filters, request, reloadKey])

  // Loading is set here rather than in the effect, which would cost an extra render
  const reload = (): void => {
    setLoading(true)
    setReloadKey((key) => key + 1)
    if (citiesFailed) setCitiesKey((key) => key + 1)
  }
  const changeFilters = (next: AnalyticsFilters): void => {
    setLoading(true)
    // A new range picks its own bucket size again
    if (next.range !== filters.range) setView((v) => ({ ...v, bucket: null }))
    setFilters(next)
  }
  const changeView = (patch: Partial<DashboardView>): void => {
    if (patch.bucket !== undefined || patch.breakdown !== undefined) setLoading(true)
    setView((v) => ({ ...v, ...patch }))
  }
  // "Last 30 days", or the custom dates
  const rangeLabel = (): string => {
    if (filters.range.preset !== 'custom' || !data) {
      return t(`govt.filters.presets.${filters.range.preset}`)
    }
    return t('govt.filters.rangeLabel', {
      from: format.date(data.from),
      to: format.date(data.to - 1)
    })
  }

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold text-stone-900">{t('govt.dashboard.title')}</h2>
        <p className="text-sm text-stone-500">
          {data
            ? t('govt.dashboard.subtitle', { time: format.dateTime(data.generatedAt) })
            : t('govt.dashboard.scope')}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setExporting(true)}
        >
          <FileDown size={16} />
          {t('govt.export.open')}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('govt.dashboard.refresh')}
          title={t('govt.dashboard.refresh')}
          disabled={loading}
          onClick={reload}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
        {/* Demo control, kept out of the way like the trip page's "Pay" */}
        <Menu
          label={t('govt.dashboard.moreActions')}
          items={[
            {
              label: (
                <>
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                    {t('billing.demo')}
                  </span>
                  {t('govt.dashboard.regenerate.action')}
                </>
              ),
              onSelect: () => setConfirming(true)
            }
          ]}
        />
      </div>
    </div>
  )

  const filterBar = (
    <div className="card p-5">
      <AnalyticsFilterFields
        filters={filters}
        cities={cities}
        owners={owners}
        onChange={changeFilters}
      />
    </div>
  )

  const spinner = (
    <div className="flex justify-center py-24 text-stone-400">
      <LoaderCircle className="animate-spin" />
    </div>
  )

  const exportDialog = exporting && (
    <ExportDialog
      initialFilters={filters}
      initialView={view}
      cities={cities}
      owners={owners}
      onClose={() => setExporting(false)}
    />
  )

  const confirmDialog = confirming && (
    <RegenerateDialog
      onClose={() => setConfirming(false)}
      onDone={(failure) => {
        if (!mounted.current) return
        setConfirming(false)
        if (failure) setError(failure)
        else reload()
      }}
    />
  )

  if (!data) {
    return (
      <section className="flex flex-col gap-6">
        {header}
        {filterBar}
        {error ? <FormAlert message={t(`fleet.errors.${error}`)} /> : spinner}
        {confirmDialog}
        {exportDialog}
      </section>
    )
  }

  const cargoTotal = data.byCargo.reduce((sum, c) => sum + c.revenue, 0)
  const taxTotal = data.byTax.reduce((sum, c) => sum + c.revenue, 0)

  return (
    <section className={`flex flex-col gap-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      {header}
      {filterBar}
      {error && <FormAlert message={t(`fleet.errors.${error}`)} />}

      <KpiGrid kpis={data.kpis} periodLabel={rangeLabel()} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          title={t(`govt.dashboard.revenue.title.${data.bucket}`)}
          className="lg:col-span-2"
          action={
            <Segmented
              label={t('govt.dashboard.revenue.groupBy')}
              options={bucketsFor(new Date(data.from), new Date(data.to)).map((bucket) => ({
                value: bucket,
                label: t(`govt.dashboard.revenue.buckets.${bucket}`)
              }))}
              value={data.bucket}
              onChange={(bucket) => changeView({ bucket })}
            />
          }
        >
          <Suspense fallback={spinner}>
            <RevenueChart
              points={data.revenueSeries}
              bucket={data.bucket}
              inProgress={data.to >= data.generatedAt}
            />
          </Suspense>
        </Card>

        <TripProgress statusCounts={data.statusCounts} />

        {/* Two short cards stacked beside the taller breakdown */}
        <div className="flex flex-col gap-6">
          <Card title={t('govt.dashboard.cargo.title')}>
            {data.byCargo.length === 0 ? (
              <Empty />
            ) : (
              <BarList
                items={data.byCargo.map((c) => ({
                  key: c.cargoType,
                  label: t(`cargoTypes.${c.cargoType}`),
                  value: c.revenue,
                  valueLabel: `${format.compactCurrency(c.revenue)} · ${format.percent(c.revenue / cargoTotal)}`,
                  detail: t('govt.dashboard.revenue.trips', { value: format.number(c.trips) })
                }))}
              />
            )}
          </Card>

          <Card title={t('govt.dashboard.tax.title')}>
            {data.byTax.length === 0 ? (
              <Empty />
            ) : (
              <BarList
                items={data.byTax.map((tax) => ({
                  key: tax.code,
                  label: t(`taxes.${tax.code}`),
                  value: tax.revenue,
                  valueLabel: `${format.compactCurrency(tax.revenue)} · ${format.percent(tax.revenue / taxTotal)}`
                }))}
              />
            )}
          </Card>
        </div>

        <BreakdownCard
          rows={data.breakdown}
          breakdownBy={data.breakdownBy}
          sort={view.sort}
          cities={cities}
          onBreakdownChange={(breakdown) => changeView({ breakdown })}
          onSortChange={(sort) => changeView({ sort })}
          className="lg:col-span-2"
        />
      </div>

      <RecentBills bills={data.recentBills} cities={cities} onOpenTrip={onOpenTrip} />

      {confirmDialog}
      {exportDialog}
    </section>
  )
}

export default GovtDashboard
