// Labels, order and trimming for the breakdown card's rows; shared by the dashboard and the report
import type { TFunction } from 'i18next'
import type { Breakdown, BreakdownSort } from '@masarat/shared/analytics'
import type { BreakdownRow } from '@masarat/shared/dashboard'
import type { CityRecord } from '@masarat/shared/fleet'
import type { Formatters } from '@masarat/ui/lib/format'

export const OTHERS_KEY = '__others__'
export const BREAKDOWN_ROWS = 10

// A row's label in the given language (routes read "origin → destination")
export function breakdownLabel(
  row: BreakdownRow,
  by: Breakdown,
  cities: readonly CityRecord[],
  t: TFunction,
  format: Formatters
): string {
  if (row.key === OTHERS_KEY) return t('govt.dashboard.breakdown.others')
  const city = (id?: number): string => format.city(cities.find((c) => c.id === id))
  switch (by) {
    case 'route':
      // The arrow points along the reading direction
      return `${city(row.originCityId)} ${format.isArabic ? '←' : '→'} ${city(row.destinationCityId)}`
    case 'originState':
    case 'destinationState':
      return format.state(cities.find((c) => c.state === row.key))
    case 'cargoType':
      return t(`cargoTypes.${row.key}`)
    case 'vehicleType':
      return t(`vehicleTypes.${row.key}`)
    case 'tripKind':
      return t(`tripKinds.${row.key}`)
    case 'company':
      return row.name ?? row.key
  }
}

// The rows in the chosen order, cut to the top ones plus one "Others" row for the rest
export function arrangeBreakdown(
  rows: readonly BreakdownRow[],
  sort: BreakdownSort,
  labelOf: (row: BreakdownRow) => string,
  locale: string,
  limit = BREAKDOWN_ROWS
): BreakdownRow[] {
  const sorted = [...rows].sort((a, b) =>
    sort === 'revenue'
      ? b.revenue - a.revenue
      : sort === 'trips'
        ? b.trips - a.trips
        : labelOf(a).localeCompare(labelOf(b), locale)
  )
  if (sorted.length <= limit) return sorted
  const rest = sorted.slice(limit - 1)
  return [
    ...sorted.slice(0, limit - 1),
    {
      key: OTHERS_KEY,
      revenue: rest.reduce((sum, r) => sum + r.revenue, 0),
      trips: rest.reduce((sum, r) => sum + r.trips, 0)
    }
  ]
}
