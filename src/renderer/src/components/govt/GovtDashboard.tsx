import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  Clock,
  LoaderCircle,
  Percent,
  RefreshCw,
  Truck,
  Route as RouteIcon
} from 'lucide-react'
import type { FleetErrorCode, TripReferenceData } from '../../../../shared/fleet'
import {
  DASHBOARD_PERIODS,
  type DashboardData,
  type DashboardPeriod
} from '../../../../shared/dashboard'
import { useFormat } from '../../lib/format'
import { useMountedRef } from '../../lib/useMountedRef'
import { FormAlert } from '../form/fields'
import PlateBadge from '../fleet/PlateBadge'
import Menu from '../ui/Menu'
import Modal from '../ui/Modal'
import { STATUS_STYLES } from '../trips/statusStyles'
import BarList from './BarList'
import KpiCard from './KpiCard'
import RevenueChart from './RevenueChart'

type Breakdown = 'routes' | 'states'

function Card({
  title,
  action,
  className = '',
  children
}: {
  title: string
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className={`card flex flex-col gap-4 p-5 ${className}`}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-stone-800">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange
}: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-1 rounded-lg border border-stone-200 bg-stone-100 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            option.value === value
              ? 'bg-white text-brand-800 shadow-sm ring-1 ring-stone-200'
              : 'text-stone-600 hover:text-stone-900'
          }`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

// Government landing view: collection totals and activity across every fleet owner
function GovtDashboard(): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const mounted = useMountedRef()
  const confirmTitleId = useId()
  const [period, setPeriod] = useState<DashboardPeriod>('30d')
  const [data, setData] = useState<DashboardData | null>(null)
  const [reference, setReference] = useState<TripReferenceData | null>(null)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [breakdown, setBreakdown] = useState<Breakdown>('routes')
  const [confirming, setConfirming] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  useEffect(() => {
    window.api.govt
      .getReferenceData()
      .then((result) => mounted.current && result.ok && setReference(result.data))
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

  const regenerate = async (): Promise<void> => {
    setRegenerating(true)
    try {
      const result = await window.api.govt.regenerateDemoData()
      if (!mounted.current) return
      if (result.ok) reload()
      else setError(result.error)
    } catch {
      if (mounted.current) setError('unknown')
    } finally {
      if (mounted.current) {
        setRegenerating(false)
        setConfirming(false)
      }
    }
  }

  const city = (id: number): string => format.city(reference?.cities.find((c) => c.id === id))
  const route = (originId: number, destinationId: number): React.JSX.Element => (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {city(originId)}
      <ArrowRight size={14} className="shrink-0 text-stone-400 rtl:-scale-x-100" />
      {city(destinationId)}
    </span>
  )
  const periodLabel = t(`govt.dashboard.periods.${period}`)

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

  const confirmDialog = confirming && (
    <Modal labelledBy={confirmTitleId} onClose={() => !regenerating && setConfirming(false)}>
      <h2 id={confirmTitleId} className="mb-2 text-lg font-semibold">
        {t('govt.dashboard.regenerate.title')}
      </h2>
      <p className="mb-6 text-sm text-stone-600">{t('govt.dashboard.regenerate.body')}</p>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={regenerating}
          onClick={() => setConfirming(false)}
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={regenerating}
          onClick={regenerate}
        >
          {regenerating && <LoaderCircle size={16} className="animate-spin" />}
          {t('govt.dashboard.regenerate.confirm')}
        </button>
      </div>
    </Modal>
  )

  if (!data) {
    return (
      <section className="flex flex-col gap-6">
        {header}
        {error ? (
          <FormAlert message={t(`fleet.errors.${error}`)} />
        ) : (
          <div className="flex justify-center py-24 text-stone-400">
            <LoaderCircle className="animate-spin" />
          </div>
        )}
        {confirmDialog}
      </section>
    )
  }

  const { kpis, statusCounts } = data
  const change =
    kpis.previousRevenue && kpis.previousRevenue > 0
      ? (kpis.revenue - kpis.previousRevenue) / kpis.previousRevenue
      : null

  // Every trip registered in the period, then how far each got
  const registered =
    statusCounts.draft + statusCounts.billed + statusCounts.paid + statusCounts.certified
  const funnel = [
    { key: 'draft', label: t('govt.dashboard.status.registered'), value: registered },
    {
      key: 'billed',
      label: t('govt.dashboard.status.billed'),
      value: statusCounts.billed + statusCounts.paid + statusCounts.certified
    },
    { key: 'certified', label: t('govt.dashboard.status.certified'), value: statusCounts.certified }
  ] as const
  const FUNNEL_BARS = { draft: 'bg-stone-400', billed: 'bg-amber-500', certified: 'bg-brand-600' }

  const breakdownItems =
    breakdown === 'routes'
      ? data.topRoutes.map((r) => ({
          key: `${r.originCityId}-${r.destinationCityId}`,
          label: route(r.originCityId, r.destinationCityId),
          value: r.revenue,
          valueLabel: format.compactCurrency(r.revenue),
          detail: t('govt.dashboard.revenue.trips', { value: format.number(r.trips) })
        }))
      : data.byState.slice(0, 8).map((s) => ({
          key: s.state,
          label: t(`states.${s.state}`, { defaultValue: s.state }),
          value: s.revenue,
          valueLabel: format.compactCurrency(s.revenue),
          detail: t('govt.dashboard.revenue.trips', { value: format.number(s.trips) })
        }))

  const cargoTotal = data.byCargo.reduce((sum, c) => sum + c.revenue, 0)
  const empty = (
    <p className="py-8 text-center text-sm text-stone-500">{t('govt.dashboard.empty')}</p>
  )

  return (
    <section className={`flex flex-col gap-6 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      {header}
      {error && <FormAlert message={t(`fleet.errors.${error}`)} />}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <KpiCard
          icon={Banknote}
          label={t('govt.dashboard.kpis.revenue')}
          value={format.compactCurrency(kpis.revenue)}
          title={format.currency(kpis.revenue)}
          caption={
            change === null ? (
              periodLabel
            ) : (
              <span className={change >= 0 ? 'text-brand-700' : 'text-red-700'}>
                {change >= 0 ? '▲' : '▼'} {format.percent(Math.abs(change))}{' '}
                <span className="text-stone-500">{t('govt.dashboard.kpis.vsPrevious')}</span>
              </span>
            )
          }
        />
        <KpiCard
          icon={RouteIcon}
          label={t('govt.dashboard.kpis.activeTrips')}
          value={format.number(kpis.activeTrips)}
          caption={t('govt.dashboard.kpis.activeTripsHint')}
        />
        <KpiCard
          icon={Clock}
          label={t('govt.dashboard.kpis.pendingBills')}
          value={format.number(kpis.pendingBills)}
          caption={t('govt.dashboard.kpis.pendingAmount', {
            amount: format.compactCurrency(kpis.pendingAmount)
          })}
        />
        <KpiCard
          icon={BadgeCheck}
          label={t('govt.dashboard.kpis.certificates')}
          value={format.number(kpis.certificatesIssued)}
          caption={periodLabel}
        />
        <KpiCard
          icon={Percent}
          label={t('govt.dashboard.kpis.collectionRate')}
          value={kpis.collectionRate === null ? '—' : format.percent(kpis.collectionRate)}
          caption={t('govt.dashboard.kpis.collectionRateHint')}
        />
        <KpiCard
          icon={Truck}
          label={t('govt.dashboard.kpis.vehicles')}
          value={format.number(kpis.vehicles)}
          caption={t('govt.dashboard.kpis.fleetOwners', { value: format.number(kpis.fleetOwners) })}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t(`govt.dashboard.revenue.title.${data.bucket}`)} className="lg:col-span-2">
          <RevenueChart points={data.revenueSeries} bucket={data.bucket} />
        </Card>

        <Card title={t('govt.dashboard.status.title')}>
          {registered === 0 ? (
            empty
          ) : (
            <ul className="flex flex-col gap-4">
              {funnel.map((step) => (
                <li key={step.key} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-stone-700">{step.label}</span>
                    <span className="font-medium text-stone-900 tabular-nums">
                      {format.number(step.value)}{' '}
                      <span className="text-xs font-normal text-stone-500">
                        {format.percent(step.value / registered)}
                      </span>
                    </span>
                  </div>
                  <div className="h-3 rounded bg-stone-100">
                    <div
                      className={`h-full rounded ${FUNNEL_BARS[step.key]}`}
                      style={{ width: `${(step.value / registered) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
              <li className="text-xs text-stone-500">
                {t('govt.dashboard.status.drafts', { value: format.number(statusCounts.draft) })}
              </li>
            </ul>
          )}
        </Card>

        <Card title={t('govt.dashboard.cargo.title')}>
          {data.byCargo.length === 0 ? (
            empty
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

        <Card
          title={t(`govt.dashboard.breakdown.${breakdown}`)}
          className="lg:col-span-2"
          action={
            <Segmented
              label={t('govt.dashboard.breakdown.label')}
              options={[
                { value: 'routes', label: t('govt.dashboard.breakdown.byRoute') },
                { value: 'states', label: t('govt.dashboard.breakdown.byState') }
              ]}
              value={breakdown}
              onChange={setBreakdown}
            />
          }
        >
          {breakdownItems.length === 0 ? empty : <BarList items={breakdownItems} />}
        </Card>
      </div>

      <Card title={t('govt.dashboard.recent.title')}>
        {data.recentBills.length === 0 ? (
          empty
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('govt.dashboard.recent.date')}</th>
                  <th>{t('govt.dashboard.recent.company')}</th>
                  <th>{t('govt.dashboard.recent.vehicle')}</th>
                  <th>{t('govt.dashboard.recent.route')}</th>
                  <th className="text-end">{t('govt.dashboard.recent.amount')}</th>
                  <th>{t('govt.dashboard.recent.status')}</th>
                </tr>
              </thead>
              <tbody>
                {data.recentBills.map((bill) => (
                  <tr key={bill.billId}>
                    <td className="whitespace-nowrap">
                      <div>{format.dateTime(bill.paidAt ?? bill.createdAt)}</div>
                      <div dir="ltr" className="font-mono text-[11px] text-stone-400">
                        {bill.billId}
                      </div>
                    </td>
                    <td>
                      <bdi>{bill.companyName}</bdi>
                    </td>
                    <td>
                      <PlateBadge plate={bill.plateNumber} />
                    </td>
                    <td>{route(bill.originCityId, bill.destinationCityId)}</td>
                    <td className="text-end whitespace-nowrap tabular-nums">
                      {format.currency(bill.amount)}
                    </td>
                    <td>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ${
                          STATUS_STYLES[bill.status === 'paid' ? 'certified' : 'billed']
                        }`}
                      >
                        {t(`govt.dashboard.recent.${bill.status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {confirmDialog}
    </section>
  )
}

export default GovtDashboard
