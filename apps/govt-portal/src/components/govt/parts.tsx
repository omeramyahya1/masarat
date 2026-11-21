import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import type { CityRecord } from '@masarat/shared/fleet'
import { useFormat } from '@masarat/ui/lib/format'

// Small building blocks shared by the dashboard cards

export function Card({
  title,
  action,
  className = '',
  children
}: {
  title: string
  action?: ReactNode
  className?: string
  children: ReactNode
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

export function Empty(): React.JSX.Element {
  const { t } = useTranslation()
  return <p className="py-8 text-center text-sm text-stone-500">{t('govt.dashboard.empty')}</p>
}

export function Segmented<T extends string>({
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
  const { i18n } = useTranslation()

  // Radio-group keyboard pattern: Tab stops on the selected option, arrow keys move the selection
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const forward = i18n.dir() === 'rtl' ? 'ArrowLeft' : 'ArrowRight'
    const backward = i18n.dir() === 'rtl' ? 'ArrowRight' : 'ArrowLeft'
    const step =
      event.key === forward || event.key === 'ArrowDown'
        ? 1
        : event.key === backward || event.key === 'ArrowUp'
          ? -1
          : 0
    if (step === 0) return
    event.preventDefault()
    const current = options.findIndex((option) => option.value === value)
    const next = (current + step + options.length) % options.length
    onChange(options[next].value)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex gap-1 rounded-lg border border-stone-200 bg-stone-100 p-0.5"
      onKeyDown={onKeyDown}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
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

// "Origin → Destination" in the current language
export function RouteLabel({
  cities,
  originId,
  destinationId
}: {
  cities: readonly CityRecord[]
  originId: number
  destinationId: number
}): React.JSX.Element {
  const format = useFormat()
  const city = (id: number): string => format.city(cities.find((c) => c.id === id))
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {city(originId)}
      <ArrowRight size={14} className="shrink-0 text-stone-400 rtl:-scale-x-100" />
      {city(destinationId)}
    </span>
  )
}
