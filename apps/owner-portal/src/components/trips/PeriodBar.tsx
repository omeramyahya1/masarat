import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'
import { MAX_PERIOD_DAYS, monthPeriod } from '@masarat/shared/fleet'
import { useFormat } from '@masarat/ui/lib/format'

type Period = { from: string; to: string }

// "YYYY-MM-DD" as a local date
const parse = (day: string): Date => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Whether a period is exactly one calendar month
function isMonth(period: Period): boolean {
  const from = parse(period.from)
  const whole = monthPeriod(from.getFullYear(), from.getMonth())
  return whole.from === period.from && whole.to === period.to
}

// The trips list's period: a month, with the previous and next ones a click away, or a range the
// member picks (at most 92 days, checked by the API). The list, its counts, groups, filters and
// search all cover this period only.
function PeriodBar({
  period,
  onChange
}: {
  // The period the API answered with (the current month when none was asked for)
  period: Period
  onChange: (period: Period) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const [custom, setCustom] = useState<Period | null>(null)
  // A range the API would refuse is caught here, so the list never loses its period bar
  const [invalid, setInvalid] = useState(false)
  const from = parse(period.from)
  const month = isMonth(period)
  const monthName = new Intl.DateTimeFormat(format.isArabic ? 'ar-SD-u-nu-latn' : 'en-US', {
    month: 'long',
    year: 'numeric'
  })
  const dayName = new Intl.DateTimeFormat(format.isArabic ? 'ar-SD-u-nu-latn' : 'en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  })
  const label = month
    ? monthName.format(from)
    : t('trips.period.range', {
        from: dayName.format(from),
        to: dayName.format(parse(period.to))
      })
  // The month before or after the one shown (for a range, the month it starts in)
  const step = (by: number): void => onChange(monthPeriod(from.getFullYear(), from.getMonth() + by))

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg border border-stone-200 bg-white p-1">
        <button
          type="button"
          className="icon-btn"
          aria-label={t('trips.period.previous')}
          onClick={() => step(-1)}
        >
          <ChevronLeft size={16} className="rtl:-scale-x-100" />
        </button>
        <span className="min-w-36 px-2 text-center text-sm font-semibold text-stone-800 tabular-nums">
          {label}
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('trips.period.next')}
          onClick={() => step(1)}
        >
          <ChevronRight size={16} className="rtl:-scale-x-100" />
        </button>
      </div>
      {custom === null ? (
        <button type="button" className="btn btn-secondary" onClick={() => setCustom(period)}>
          <CalendarRange size={16} />
          {t('trips.period.custom')}
        </button>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const days = (parse(custom.to).getTime() - parse(custom.from).getTime()) / 86_400_000
            if (!(days >= 0 && days < MAX_PERIOD_DAYS)) return setInvalid(true)
            setInvalid(false)
            onChange(custom)
            setCustom(null)
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-stone-500">
            {t('trips.period.from')}
            <input
              type="date"
              className="input"
              required
              value={custom.from}
              onChange={(e) => setCustom({ ...custom, from: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-stone-500">
            {t('trips.period.to')}
            <input
              type="date"
              className="input"
              required
              value={custom.to}
              onChange={(e) => setCustom({ ...custom, to: e.target.value })}
            />
          </label>
          <button type="submit" className="btn btn-primary">
            {t('trips.period.apply')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setCustom(null)
              setInvalid(false)
            }}
          >
            {t('common.cancel')}
          </button>
          <span
            role={invalid ? 'alert' : undefined}
            className={`w-full text-xs ${invalid ? 'text-red-700' : 'text-stone-500'}`}
          >
            {t(invalid ? 'fleet.errors.invalid_period' : 'trips.period.limit')}
          </span>
        </form>
      )}
    </div>
  )
}

export default PeriodBar
