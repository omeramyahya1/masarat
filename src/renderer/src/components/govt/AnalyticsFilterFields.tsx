import { useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import {
  FILTER_KEYS,
  RANGE_PRESETS,
  formatDay,
  hasFilter,
  type AnalyticsFilters,
  type DateRange,
  type OwnerOption
} from '../../../../shared/analytics'
import { CARGO_TYPES, TRIP_KINDS, VEHICLE_TYPES, type CityRecord } from '../../../../shared/fleet'
import { useFormat } from '../../lib/format'
import { Segmented } from './parts'

type RangeChoice = DateRange['preset']

interface Option {
  value: string
  label: string
}

// A compact labelled select for the filter bar; options can be grouped
function FilterSelect({
  label,
  value,
  options,
  groups,
  onChange
}: {
  label: string
  value: string
  options?: readonly Option[]
  groups?: readonly { label: string; options: readonly Option[] }[]
  onChange: (value: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-stone-500">
        {label}
      </label>
      <select
        id={id}
        className={`input py-1.5 text-sm ${value ? 'border-brand-300 bg-brand-50/40' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t('govt.filters.all')}</option>
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {groups?.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}

// A route end as one select: a whole state ("state:<name>") or one city ("city:<id>")
const placeValue = (cityId?: number | null, state?: string | null): string =>
  cityId ? `city:${cityId}` : state ? `state:${state}` : ''

function parsePlace(value: string): { cityId: number | null; state: string | null } {
  if (value.startsWith('city:')) return { cityId: Number(value.slice(5)), state: null }
  if (value.startsWith('state:')) return { cityId: null, state: value.slice(6) }
  return { cityId: null, state: null }
}

// The period and the trip filters shared by the dashboard and the export dialog
function AnalyticsFilterFields({
  filters,
  cities,
  owners,
  showOwner = true,
  onChange
}: {
  filters: AnalyticsFilters
  cities: readonly CityRecord[]
  owners: readonly OwnerOption[]
  // The export dialog leaves out the owner filter
  showOwner?: boolean
  onChange: (filters: AnalyticsFilters) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const fromId = useId()
  const toId = useId()
  const range = filters.range

  // Cities grouped by state, each group led by "the whole state"
  const placeGroups = useMemo(() => {
    const byState = new Map<string, CityRecord[]>()
    for (const city of cities) byState.set(city.state, [...(byState.get(city.state) ?? []), city])
    const stateName = (state: string): string => t(`states.${state}`, { defaultValue: state })
    return [...byState]
      .map(([state, list]) => ({
        label: stateName(state),
        options: [
          {
            value: `state:${state}`,
            label: t('govt.filters.wholeState', { state: stateName(state) })
          },
          ...list
            .map((city) => ({ value: `city:${city.id}`, label: format.city(city) }))
            .sort((a, b) => a.label.localeCompare(b.label, format.isArabic ? 'ar' : 'en'))
        ]
      }))
      .sort((a, b) => a.label.localeCompare(b.label, format.isArabic ? 'ar' : 'en'))
  }, [cities, format, t])

  const setRange = (choice: RangeChoice): void => {
    if (choice === 'custom') {
      // Start from the last 30 days
      const to = new Date()
      const from = new Date(to)
      from.setDate(from.getDate() - 29)
      onChange({
        ...filters,
        range: { preset: 'custom', from: formatDay(from), to: formatDay(to) }
      })
    } else onChange({ ...filters, range: { preset: choice } })
  }
  const setPlace = (side: 'origin' | 'destination', value: string): void => {
    const { cityId, state } = parsePlace(value)
    onChange({ ...filters, [`${side}CityId`]: cityId, [`${side}State`]: state })
  }
  const set = <K extends keyof AnalyticsFilters>(key: K, value: AnalyticsFilters[K]): void =>
    onChange({ ...filters, [key]: value })
  const active = FILTER_KEYS.filter((key) => hasFilter(filters, key)).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-stone-500">{t('govt.filters.period')}</span>
          <Segmented
            label={t('govt.filters.period')}
            options={[...RANGE_PRESETS, 'custom' as const].map((preset) => ({
              value: preset,
              label: t(`govt.filters.presets.${preset}`)
            }))}
            value={range.preset}
            onChange={setRange}
          />
        </div>
        {range.preset === 'custom' && (
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={fromId} className="text-xs font-medium text-stone-500">
                {t('govt.filters.from')}
              </label>
              <input
                id={fromId}
                type="date"
                className="input py-1.5 text-sm"
                value={range.from}
                max={range.to}
                onChange={(e) =>
                  e.target.value &&
                  onChange({ ...filters, range: { ...range, from: e.target.value } })
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={toId} className="text-xs font-medium text-stone-500">
                {t('govt.filters.to')}
              </label>
              <input
                id={toId}
                type="date"
                className="input py-1.5 text-sm"
                value={range.to}
                min={range.from}
                onChange={(e) =>
                  e.target.value &&
                  onChange({ ...filters, range: { ...range, to: e.target.value } })
                }
              />
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <FilterSelect
          label={t('govt.filters.origin')}
          value={placeValue(filters.originCityId, filters.originState)}
          groups={placeGroups}
          onChange={(value) => setPlace('origin', value)}
        />
        <FilterSelect
          label={t('govt.filters.destination')}
          value={placeValue(filters.destinationCityId, filters.destinationState)}
          groups={placeGroups}
          onChange={(value) => setPlace('destination', value)}
        />
        <FilterSelect
          label={t('govt.filters.cargoType')}
          value={filters.cargoType ?? ''}
          options={CARGO_TYPES.map((c) => ({ value: c, label: t(`cargoTypes.${c}`) }))}
          onChange={(value) => set('cargoType', (value || null) as AnalyticsFilters['cargoType'])}
        />
        <FilterSelect
          label={t('govt.filters.vehicleType')}
          value={filters.vehicleType ?? ''}
          options={VEHICLE_TYPES.map((v) => ({ value: v, label: t(`vehicleTypes.${v}`) }))}
          onChange={(value) =>
            set('vehicleType', (value || null) as AnalyticsFilters['vehicleType'])
          }
        />
        <FilterSelect
          label={t('govt.filters.tripKind')}
          value={filters.tripKind ?? ''}
          options={TRIP_KINDS.map((k) => ({ value: k, label: t(`tripKinds.${k}`) }))}
          onChange={(value) => set('tripKind', (value || null) as AnalyticsFilters['tripKind'])}
        />
        {showOwner && (
          <FilterSelect
            label={t('govt.filters.owner')}
            value={filters.ownerId ? String(filters.ownerId) : ''}
            options={owners.map((o) => ({ value: String(o.id), label: o.name }))}
            onChange={(value) => set('ownerId', value ? Number(value) : null)}
          />
        )}
      </div>

      {active > 0 && (
        <div className="flex items-center gap-3 text-xs text-stone-500">
          <span>{t('govt.filters.active', { count: active })}</span>
          <button
            type="button"
            className="link inline-flex items-center gap-1"
            onClick={() => onChange({ range: filters.range })}
          >
            <X size={12} />
            {t('govt.filters.clear')}
          </button>
        </div>
      )}
    </div>
  )
}

export default AnalyticsFilterFields
