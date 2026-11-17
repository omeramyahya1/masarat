import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps
} from 'recharts'
import type { BucketSize, RevenuePoint } from '../../../../shared/dashboard'
import { useFormat } from '../../lib/format'

// Theme tokens from main.css
const LINE = 'var(--color-brand-600)'
const GRID = 'var(--color-stone-200)'
const TICK = 'var(--color-stone-500)'

// Collected revenue per day, week or month
function RevenueChart({
  points,
  bucket
}: {
  points: RevenuePoint[]
  bucket: BucketSize
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const format = useFormat()
  // useId's punctuation isn't valid inside url(#…)
  const gradientId = `revenue-${useId().replace(/[^\w-]/g, '')}`
  const locale = format.isArabic ? 'ar-SD-u-nu-latn' : 'en-US'
  const tickFormat = new Intl.DateTimeFormat(
    locale,
    bucket === 'month' ? { month: 'short' } : { month: 'short', day: 'numeric' }
  )
  const labelFormat = new Intl.DateTimeFormat(
    locale,
    bucket === 'month' ? { month: 'long', year: 'numeric' } : { dateStyle: 'medium' }
  )

  // The last bucket is still in progress, so it is drawn dashed instead of reading as a drop
  const last = points.length - 1
  const data = points.map((point, index) => ({
    ...point,
    toDate: index === last,
    complete: index < last ? point.revenue : null,
    current: index >= last - 1 ? point.revenue : null
  }))

  const renderTooltip = ({ active, payload }: TooltipContentProps): React.JSX.Element | null => {
    const point = payload?.[0]?.payload as (typeof data)[number] | undefined
    if (!active || !point) return null
    return (
      <div
        dir={i18n.dir()}
        className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm shadow-lg"
      >
        <div className="mb-1 text-xs text-stone-500">
          {bucket === 'week'
            ? t('govt.dashboard.revenue.weekOf', { date: labelFormat.format(point.start) })
            : labelFormat.format(point.start)}
          {point.toDate && ` · ${t('govt.dashboard.revenue.soFar')}`}
        </div>
        <div className="font-semibold text-stone-900 tabular-nums">
          {format.currency(point.revenue)}
        </div>
        <div className="text-xs text-stone-500 tabular-nums">
          {t('govt.dashboard.revenue.trips', { value: format.number(point.trips) })}
        </div>
      </div>
    )
  }

  // Time reads left to right in both languages; in Arabic the value axis sits on the right
  return (
    <div className="flex flex-col gap-2">
      <div dir="ltr" className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={LINE} stopOpacity={0.22} />
                <stop offset="100%" stopColor={LINE} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey="start"
              tickFormatter={(value: number) => tickFormat.format(value)}
              tick={{ fill: TICK, fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              minTickGap={24}
            />
            <YAxis
              orientation={format.isArabic ? 'right' : 'left'}
              tickFormatter={(value: number) => format.compactNumber(value)}
              tick={{ fill: TICK, fontSize: 12 }}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              content={renderTooltip}
              cursor={{ stroke: 'var(--color-stone-400)', strokeDasharray: '3 3' }}
            />
            <Area
              type="monotone"
              dataKey="complete"
              stroke={LINE}
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              activeDot={{ r: 4, stroke: 'white', strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Area
              type="linear"
              dataKey="current"
              stroke={LINE}
              strokeWidth={2}
              strokeDasharray="4 4"
              fill={`url(#${gradientId})`}
              fillOpacity={0.5}
              activeDot={{ r: 4, stroke: 'white', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-stone-500">{t(`govt.dashboard.revenue.toDateNote.${bucket}`)}</p>
    </div>
  )
}

export default RevenueChart
