import { useTranslation } from 'react-i18next'
import type { CityRecord } from '../../../../shared/fleet'
import type { RecentBill } from '../../../../shared/dashboard'
import { useFormat } from '../../lib/format'
import PlateBadge from '../fleet/PlateBadge'
import { STATUS_STYLES } from '../trips/statusStyles'
import { Card, Empty, RouteLabel } from './parts'

// Latest bills across all owners, paid or still pending
function RecentBills({
  bills,
  cities
}: {
  bills: RecentBill[]
  cities: readonly CityRecord[]
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()

  return (
    <Card title={t('govt.dashboard.recent.title')}>
      {bills.length === 0 ? (
        <Empty />
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
              {bills.map((bill) => (
                <tr key={bill.billId}>
                  <td className="whitespace-nowrap">
                    <div>{format.dateTime(bill.paidAt ?? bill.createdAt)}</div>
                    <div dir="ltr" className="font-mono text-[11px] text-stone-400">
                      {bill.billId}
                    </div>
                  </td>
                  <td>
                    {/* Company names are Latin; isolate them so punctuation stays put in Arabic */}
                    <bdi>{bill.companyName}</bdi>
                  </td>
                  <td>
                    <PlateBadge plate={bill.plateNumber} />
                  </td>
                  <td>
                    <RouteLabel
                      cities={cities}
                      originId={bill.originCityId}
                      destinationId={bill.destinationCityId}
                    />
                  </td>
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
  )
}

export default RecentBills
