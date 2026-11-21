import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import type { GovtSearchInput } from '@masarat/shared/billing'
import type { CityRecord } from '@masarat/shared/fleet'
import { useFormat } from '@masarat/ui/lib/format'

// The government's search box: bill ID, receipt / manifest number, trip number, plate or name,
// and optionally a route
function GovtSearchBar({
  cities,
  active,
  onSearch,
  onClear
}: {
  cities: readonly CityRecord[]
  // A search is showing its results
  active: boolean
  onSearch: (input: GovtSearchInput) => void
  onClear: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const inputId = useId()
  const originId = useId()
  const destinationId = useId()
  const [query, setQuery] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const cityOptions = [...cities]
    .map((c) => ({ value: String(c.id), label: format.city(c) }))
    .sort((a, b) => a.label.localeCompare(b.label, format.isArabic ? 'ar' : 'en'))
  const canSearch = query.trim() !== '' || origin !== '' || destination !== ''

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!canSearch) return
    onSearch({
      query: query.trim(),
      originCityId: origin ? Number(origin) : null,
      destinationCityId: destination ? Number(destination) : null
    })
  }
  const clear = (): void => {
    setQuery('')
    setOrigin('')
    setDestination('')
    onClear()
  }

  return (
    <form
      role="search"
      className="flex flex-col gap-3 border-b border-stone-200 bg-white px-6 py-3"
      onSubmit={submit}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          {t('govt.search.label')}
        </label>
        <div className="relative flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute inset-y-0 start-3 my-auto text-stone-400"
          />
          <input
            id={inputId}
            type="search"
            className="input ps-9"
            placeholder={t('govt.search.placeholder')}
            value={query}
            maxLength={80}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          type="button"
          className={`btn btn-secondary ${advanced ? 'ring-2 ring-brand-200' : ''}`}
          aria-expanded={advanced}
          onClick={() => setAdvanced((v) => !v)}
        >
          <SlidersHorizontal size={16} />
          {t('govt.search.route')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={!canSearch}>
          {t('govt.search.submit')}
        </button>
        {active && (
          <button type="button" className="btn btn-secondary" onClick={clear}>
            <X size={16} />
            {t('govt.search.clear')}
          </button>
        )}
      </div>
      {advanced && (
        <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-3">
          {(
            [
              [originId, 'origin', origin, setOrigin],
              [destinationId, 'destination', destination, setDestination]
            ] as const
          ).map(([id, key, value, setValue]) => (
            <div key={key} className="flex flex-col gap-1">
              <label htmlFor={id} className="text-xs font-medium text-stone-500">
                {t(`govt.filters.${key}`)}
              </label>
              <select
                id={id}
                className="input py-1.5 text-sm"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              >
                <option value="">{t('govt.filters.all')}</option>
                {cityOptions.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </form>
  )
}

export default GovtSearchBar
