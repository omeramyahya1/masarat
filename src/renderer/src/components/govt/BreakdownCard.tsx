import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CityRecord } from '../../../../shared/fleet'
import type { RouteRevenue, StateRevenue } from '../../../../shared/dashboard'
import { useFormat } from '../../lib/format'
import BarList from './BarList'
import { Card, Empty, RouteLabel, Segmented } from './parts'

type Breakdown = 'routes' | 'states'

const MAX_ROWS = 8

// Revenue ranked by route or by the origin city's state
function BreakdownCard({
  topRoutes,
  byState,
  cities,
  className
}: {
  topRoutes: RouteRevenue[]
  byState: StateRevenue[]
  cities: readonly CityRecord[]
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const [breakdown, setBreakdown] = useState<Breakdown>('routes')
  const trips = (count: number): string =>
    t('govt.dashboard.revenue.trips', { value: format.number(count) })

  const items =
    breakdown === 'routes'
      ? topRoutes.map((r) => ({
          key: `${r.originCityId}-${r.destinationCityId}`,
          label: (
            <RouteLabel
              cities={cities}
              originId={r.originCityId}
              destinationId={r.destinationCityId}
            />
          ),
          value: r.revenue,
          valueLabel: format.compactCurrency(r.revenue),
          detail: trips(r.trips)
        }))
      : byState.slice(0, MAX_ROWS).map((s) => ({
          key: s.state,
          label: t(`states.${s.state}`, { defaultValue: s.state }),
          value: s.revenue,
          valueLabel: format.compactCurrency(s.revenue),
          detail: trips(s.trips)
        }))

  return (
    <Card
      title={t(`govt.dashboard.breakdown.${breakdown}`)}
      className={className}
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
      {items.length === 0 ? <Empty /> : <BarList items={items} />}
    </Card>
  )
}

export default BreakdownCard
