import { lazy, Suspense, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { FileDown, LoaderCircle, RefreshCw } from 'lucide-react'
import type { FleetErrorCode } from '@masarat/shared/fleet'
import { mergeDashboard, type DashboardData } from '@masarat/shared/dashboard'
import {
  DEFAULT_FILTERS,
  DEFAULT_VIEW,
  bucketsFor,
  formatDay,
  type AnalyticsFilters,
  type DashboardView
} from '@masarat/shared/analytics'
import { useFormat } from '@masarat/ui/lib/format'
import { useMountedRef } from '@masarat/ui/lib/useMountedRef'
import { useGovtReference } from '@masarat/ui/lib/queries'
import { msUntilNextAggregation } from './dashboardData'
import { errorCode, queryClient, queryKeys, unwrap } from '@masarat/ui/lib/query'
import { useSessionState } from '@masarat/ui/lib/useSessionState'
import { FormAlert } from '@masarat/ui/components/form/fields'
import Menu from '@masarat/ui/components/ui/Menu'
import AnalyticsFilterFields from './AnalyticsFilterFields'
import BarList from './BarList'
import BreakdownCard from './BreakdownCard'
import ExportDialog from './ExportDialog'
import KpiGrid from './KpiGrid'
import RecentBills from './RecentBills'
import RegenerateDialog from './RegenerateDialog'
import TripProgress from './TripProgress'
import { Card, Empty, Segmented } from './parts'
import { api } from '@masarat/api-client'

// Recharts is large; load it only when the government panel opens
const RevenueChart = lazy(() => import('./RevenueChart'))

// Government landing view: collection totals and activity across every company
function GovtDashboard({
  onOpenTrip
}: {
  onOpenTrip: (manifestId: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const mounted = useMountedRef()
  // Kept for the session, so leaving the dashboard and coming back finds the same view
  const [filters, setFilters] = useSessionState<AnalyticsFilters>(
    'masarat.govt.dashboard.filters',
    DEFAULT_FILTERS
  )
  const [view, setView] = useSessionState<DashboardView>(
    'masarat.govt.dashboard.view',
    DEFAULT_VIEW
  )
  // The company breakdown comes from a rollup without routes or cargo (the nightly aggregates):
  // with a route or cargo filter it isn't offered, and the breakdown shows routes instead
  const companyBreakdown =
    !filters.originCityId &&
    !filters.destinationCityId &&
    !filters.originState &&
    !filters.destinationState &&
    !filters.cargoType
  const breakdown = view.breakdown === 'company' && !companyBreakdown ? 'route' : view.breakdown
  // What the API needs; the breakdown's sort is applied here without asking it again
  const request = useMemo<DashboardView>(
    () => ({ bucket: view.bucket, breakdown, sort: 'revenue' }),
    [view.bucket, breakdown]
  )
  // Two parts, each cached (lib/query.ts): the history (whole past days from the nightly
  // aggregates) is kept until the next night; today is asked for once, then on Refresh. Exact
  // figures to the minute aren't needed: availability first. While other filters load, the last
  // figures stay shown.
  const historyQuery = useQuery({
    queryKey: [...queryKeys.dashboard(filters, request), 'history', formatDay(new Date())],
    queryFn: () => unwrap(api.govt.dashboardHistory(filters, request)),
    staleTime: msUntilNextAggregation(),
    gcTime: msUntilNextAggregation(),
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData
  })
  const todayQuery = useQuery({
    queryKey: [...queryKeys.dashboard(filters, request), 'today'],
    queryFn: () => unwrap(api.govt.dashboardToday(filters, request)),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData
  })
  const data: DashboardData | null = useMemo(
    () =>
      historyQuery.data
        ? mergeDashboard(filters, request, new Date(), historyQuery.data, todayQuery.data ?? null)
        : null,
    [filters, request, historyQuery.data, todayQuery.data]
  )
  // City names only label routes; if they fail to load, the next refresh retries them
  const referenceQuery = useGovtReference()
  const cities = referenceQuery.data?.cities ?? []
  const [actionError, setError] = useState<FleetErrorCode | null>(null)
  const error = actionError ?? errorCode<FleetErrorCode>(historyQuery.error ?? todayQuery.error)
  const loading = historyQuery.isFetching || todayQuery.isFetching
  const [confirming, setConfirming] = useState(false)
  const [exporting, setExporting] = useState(false)

  const reload = (): void => {
    setError(null)
    // Refresh asks only for today: the history doesn't change before the night
    void todayQuery.refetch()
    if (referenceQuery.isError) void referenceQuery.refetch()
  }
  const changeFilters = (next: AnalyticsFilters): void => {
    // A new range picks its own bucket size again
    if (next.range !== filters.range) setView((v) => ({ ...v, bucket: null }))
    setFilters(next)
  }
  const changeView = (patch: Partial<DashboardView>): void => {
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
      <AnalyticsFilterFields filters={filters} cities={cities} onChange={changeFilters} />
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
        // Every company's data changed: everything cached goes
        else void queryClient.invalidateQueries()
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
                  label: format.chargeName(tax),
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
          companyAvailable={companyBreakdown}
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
