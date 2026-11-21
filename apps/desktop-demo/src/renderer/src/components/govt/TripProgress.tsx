import { useTranslation } from 'react-i18next'
import type { ManifestStatus } from '../../../../shared/fleet'
import { useFormat } from '../../lib/format'
import { Card, Empty } from './parts'

const BAR_COLORS = {
  registered: 'bg-stone-400',
  billed: 'bg-amber-500',
  certified: 'bg-brand-600'
} as const

// Trips registered in the period, then how many got a bill and how many were paid
function TripProgress({
  statusCounts
}: {
  statusCounts: Record<ManifestStatus, number>
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const { draft, billed, paid, certified } = statusCounts
  const registered = draft + billed + paid + certified
  const steps = [
    { key: 'registered', value: registered },
    { key: 'billed', value: billed + paid + certified },
    { key: 'certified', value: certified }
  ] as const

  return (
    <Card title={t('govt.dashboard.status.title')}>
      {registered === 0 ? (
        <Empty />
      ) : (
        <ul className="flex flex-col gap-4">
          {steps.map((step) => (
            <li key={step.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-stone-700">{t(`govt.dashboard.status.${step.key}`)}</span>
                <span className="font-medium text-stone-900 tabular-nums">
                  {format.number(step.value)}{' '}
                  <span className="text-xs font-normal text-stone-500">
                    {format.percent(step.value / registered)}
                  </span>
                </span>
              </div>
              <div className="h-3 rounded bg-stone-100">
                <div
                  className={`h-full rounded ${BAR_COLORS[step.key]}`}
                  style={{ width: `${(step.value / registered) * 100}%` }}
                />
              </div>
            </li>
          ))}
          <li className="text-xs text-stone-500">
            {t('govt.dashboard.status.drafts', { value: format.number(draft) })}
          </li>
        </ul>
      )}
    </Card>
  )
}

export default TripProgress
