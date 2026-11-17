import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import type { CityRecord, FleetErrorCode } from '../../../../shared/fleet'
import {
  DASHBOARD_PERIODS,
  type DashboardData,
  type DashboardPeriod
} from '../../../../shared/dashboard'
import { useFormat } from '../../lib/format'
import { useMountedRef } from '../../lib/useMountedRef'
import { FormAlert } from '../form/fields'
import Menu from '../ui/Menu'
import BarList from './BarList'
import BreakdownCard from './BreakdownCard'
import KpiGrid from './KpiGrid'
import RecentBills from './RecentBills'
import RegenerateDialog from './RegenerateDialog'
import TripProgress from './TripProgress'
import { Card, Empty, Segmented } from './parts'

// Recharts is large; load it only when the government panel opens
const RevenueChart = lazy(() => import('./RevenueChart'))

// Government landing view: collection totals and activity across every fleet owner
function GovtDashboard(): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const mounted = useMountedRef()
  const [period, setPeriod] = useState<DashboardPeriod>('30d')
  const [data, setData] = useState<DashboardData | null>(null)
  const [cities, setCities] = useState<CityRecord[]>([])
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    window.api.govt
      .getReferenceData()
      .then((result) => mounted.current && result.ok && setCities(result.data.cities))
      .catch(() => undefined)
  }, [mounted])

  useEffect(() => {
    let current = true
    window.api.govt
      .dashboard(period)
      .then((result) => {
        if (!current) return
        if (result.ok) {
          setData(result.data)
          setError(null)
        } else setError(result.error)
      })
      .catch(() => current && setError('unknown'))
      .finally(() => current && setLoading(false))
    // A newer request (period change or refresh) supersedes this one
    return (): void => {
      current = false
    }
  }, [period, reloadKey])

  // Loading is set here rather than in the effect, which would cost an extra render
  const reload = (): void => {
    setLoading(true)
    setReloadKey((key) => key + 1)
  }
  const changePeriod = (value: DashboardPeriod): void => {
    if (value === period) return
    setLoading(true)
    setPeriod(value)
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
        <Segmented
          label={t('govt.dashboard.period')}
          options={DASHBOARD_PERIODS.map((value) => ({
            value,
            label: t(`govt.dashboard.periods.${value}`)
          }))}
          value={period}
          onChange={changePeriod}
        />
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

  const spinner = (
    <div className="flex justify-center py-24 text-stone-400">
      <LoaderCircle className="animate-spin" />
    </div>
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
        {error ? <FormAlert message={t(`fleet.errors.${error}`)} /> : spinner}
        {confirmDialog}
      </section>
    )
  }

  const cargoTotal = data.byCargo.reduce((sum, c) => sum + c.revenue, 0)

  return (
    <section className={`flex flex-col gap-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      {header}
      {error && <FormAlert message={t(`fleet.errors.${error}`)} />}

      <KpiGrid kpis={data.kpis} periodLabel={t(`govt.dashboard.periods.${period}`)} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t(`govt.dashboard.revenue.title.${data.bucket}`)} className="lg:col-span-2">
          <Suspense fallback={spinner}>
            <RevenueChart points={data.revenueSeries} bucket={data.bucket} />
          </Suspense>
        </Card>

        <TripProgress statusCounts={data.statusCounts} />

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

        <BreakdownCard
          topRoutes={data.topRoutes}
          byState={data.byState}
          cities={cities}
          className="lg:col-span-2"
        />
      </div>

      <RecentBills bills={data.recentBills} cities={cities} />

      {confirmDialog}
    </section>
  )
}

export default GovtDashboard
