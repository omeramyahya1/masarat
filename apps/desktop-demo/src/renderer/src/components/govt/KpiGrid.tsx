import { useTranslation } from 'react-i18next'
import { BadgeCheck, Banknote, Clock, Percent, Route, Truck } from 'lucide-react'
import type { DashboardKpis } from '../../../../shared/dashboard'
import { useFormat } from '../../lib/format'
import KpiCard from './KpiCard'

function KpiGrid({
  kpis,
  periodLabel
}: {
  kpis: DashboardKpis
  periodLabel: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const change =
    kpis.previousRevenue && kpis.previousRevenue > 0
      ? (kpis.revenue - kpis.previousRevenue) / kpis.previousRevenue
      : null

  return (
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
        icon={Route}
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
  )
}

export default KpiGrid
