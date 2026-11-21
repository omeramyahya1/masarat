import type { ReactNode } from 'react'

export interface BarListItem {
  key: string
  label: ReactNode
  value: number
  // Text shown at the end of the row, e.g. the formatted amount
  valueLabel: string
  detail?: string
}

// Ranked horizontal bars in plain HTML, so they follow the reading direction in Arabic
function BarList({ items }: { items: BarListItem[] }): React.JSX.Element {
  const max = Math.max(...items.map((item) => item.value), 1)
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-stone-700">{item.label}</span>
              {item.detail && (
                <span className="shrink-0 text-xs text-stone-500">{item.detail}</span>
              )}
            </span>
            <span className="shrink-0 font-medium text-stone-900 tabular-nums">
              {item.valueLabel}
            </span>
          </div>
          <div className="h-2 rounded-full bg-stone-100">
            <div
              className="h-full rounded-full bg-brand-600"
              style={{ width: `${Math.max((item.value / max) * 100, 1)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

export default BarList
