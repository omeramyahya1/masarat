import { useTranslation } from 'react-i18next'
import type { TaxLine } from '../../../../shared/tax'
import { useFormat } from '../../lib/format'

// Trip cost, then each tax as a percentage of it and each fixed fee, then the total due
function TaxBreakdown({
  tripCost,
  lines,
  total
}: {
  tripCost: number | null
  lines: readonly TaxLine[] | null
  total: number | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const money = (value: number | null | undefined): string =>
    value === null || value === undefined ? '—' : format.currency(value)

  return (
    <dl className="flex flex-col gap-2 text-sm">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-stone-500">{t('trips.tax.tripCost')}</dt>
        <dd className="font-medium whitespace-nowrap text-stone-900 tabular-nums">
          {money(tripCost)}
        </dd>
      </div>
      {lines?.map((line) => (
        <div key={line.code} className="flex items-baseline justify-between gap-4">
          <dt className="text-stone-500">{format.taxLine(line)}</dt>
          <dd className="whitespace-nowrap text-stone-900 tabular-nums">
            {money(tripCost === null ? null : line.amount)}
          </dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4 border-t border-stone-200 pt-2">
        <dt className="font-medium text-stone-800">{t('trips.tax.total')}</dt>
        <dd className="text-base font-semibold whitespace-nowrap text-stone-900 tabular-nums">
          {money(total)}
        </dd>
      </div>
    </dl>
  )
}

export default TaxBreakdown
