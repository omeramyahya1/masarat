import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BREAKDOWNS,
  BREAKDOWN_SORTS,
  type Breakdown,
  type BreakdownSort
} from '@masarat/shared/analytics'
import type { BreakdownRow } from '@masarat/shared/dashboard'
import type { CityRecord } from '@masarat/shared/fleet'
import { useFormat } from '@masarat/ui/lib/format'
import BarList from './BarList'
import { arrangeBreakdown, breakdownLabel } from './breakdownRows'
import { Card, Empty } from './parts'

// Revenue grouped by a dimension the user picks (route, state, cargo type, company, …) and sorted
// by revenue, trips or name
function BreakdownCard({
  rows,
  breakdownBy,
  sort,
  cities,
  onBreakdownChange,
  onSortChange,
  className
}: {
  rows: readonly BreakdownRow[]
  breakdownBy: Breakdown
  sort: BreakdownSort
  cities: readonly CityRecord[]
  onBreakdownChange: (value: Breakdown) => void
  onSortChange: (value: BreakdownSort) => void
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const groupId = useId()
  const sortId = useId()
  const labelOf = (row: BreakdownRow): string => breakdownLabel(row, breakdownBy, cities, t, format)
  const total = rows.reduce((sum, r) => sum + r.revenue, 0)
  const items = arrangeBreakdown(rows, sort, labelOf, format.isArabic ? 'ar' : 'en').map((row) => ({
    key: row.key,
    label: labelOf(row),
    value: row.revenue,
    valueLabel: `${format.compactCurrency(row.revenue)} · ${format.percent(total > 0 ? row.revenue / total : 0)}`,
    detail: t('govt.dashboard.revenue.trips', { value: format.number(row.trips) })
  }))

  return (
    <Card
      title={t(`govt.dashboard.breakdown.title.${breakdownBy}`)}
      className={className}
      action={
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor={groupId} className="text-stone-500">
            {t('govt.dashboard.breakdown.groupBy')}
          </label>
          <select
            id={groupId}
            className="input py-1 text-xs"
            value={breakdownBy}
            onChange={(e) => onBreakdownChange(e.target.value as Breakdown)}
          >
            {BREAKDOWNS.map((b) => (
              <option key={b} value={b}>
                {t(`govt.dashboard.breakdown.by.${b}`)}
              </option>
            ))}
          </select>
          <label htmlFor={sortId} className="text-stone-500">
            {t('govt.dashboard.breakdown.sortBy')}
          </label>
          <select
            id={sortId}
            className="input py-1 text-xs"
            value={sort}
            onChange={(e) => onSortChange(e.target.value as BreakdownSort)}
          >
            {BREAKDOWN_SORTS.map((s) => (
              <option key={s} value={s}>
                {t(`govt.dashboard.breakdown.sort.${s}`)}
              </option>
            ))}
          </select>
        </div>
      }
    >
      {items.length === 0 ? <Empty /> : <BarList items={items} />}
    </Card>
  )
}

export default BreakdownCard
