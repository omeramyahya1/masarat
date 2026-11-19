import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, SearchX } from 'lucide-react'
import type { GovtSearchInput, GovtSearchResult } from '../../../../shared/billing'
import { MAX_SEARCH_RESULTS } from '../../../../shared/billing'
import type { CityRecord, FleetErrorCode } from '../../../../shared/fleet'
import { useFormat } from '../../lib/format'
import { FormAlert } from '../form/fields'
import PlateBadge from '../fleet/PlateBadge'
import { STATUS_STYLES } from '../trips/statusStyles'
import { RouteLabel } from './parts'

// Trips of every owner matching the government search
function GovtSearch({
  input,
  cities,
  onOpenTrip
}: {
  input: GovtSearchInput
  cities: readonly CityRecord[]
  onOpenTrip: (manifestId: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const [results, setResults] = useState<GovtSearchResult[] | null>(null)
  const [error, setError] = useState<FleetErrorCode | null>(null)

  useEffect(() => {
    let current = true
    window.api.govt
      .search(input)
      .then((result) => {
        if (!current) return
        if (result.ok) {
          setResults(result.data)
          setError(null)
        } else setError(result.error)
      })
      .catch(() => current && setError('unknown'))
    // A newer search supersedes this one
    return (): void => {
      current = false
    }
  }, [input])

  if (error) return <FormAlert message={t(`fleet.errors.${error}`)} />
  if (!results) {
    return (
      <div className="flex justify-center py-16 text-stone-400">
        <LoaderCircle className="animate-spin" />
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-stone-900">{t('govt.search.resultsTitle')}</h2>
        <p className="text-sm text-stone-500">
          {results.length >= MAX_SEARCH_RESULTS
            ? t('govt.search.manyResults', { count: format.number(MAX_SEARCH_RESULTS) })
            : t('govt.search.resultCount', { count: format.number(results.length) })}
        </p>
      </div>

      {results.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <SearchX size={28} className="text-stone-400" />
          <p className="max-w-sm text-sm text-stone-500">{t('govt.search.noResults')}</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('govt.search.columns.trip')}</th>
                <th>{t('govt.search.columns.billId')}</th>
                <th>{t('govt.search.columns.company')}</th>
                <th>{t('govt.search.columns.vehicle')}</th>
                <th>{t('govt.search.columns.route')}</th>
                <th className="text-end">{t('govt.search.columns.amount')}</th>
                <th>{t('govt.search.columns.status')}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((trip) => (
                <tr
                  key={trip.manifestId}
                  className="cursor-pointer hover:bg-stone-50"
                  onClick={() => onOpenTrip(trip.manifestId)}
                >
                  <td className="whitespace-nowrap">
                    {/* Keyboard access to the row; the row itself handles mouse clicks */}
                    <button
                      type="button"
                      className="text-start hover:underline"
                      aria-label={t('govt.search.openTrip', { id: format.number(trip.manifestId) })}
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenTrip(trip.manifestId)
                      }}
                    >
                      <div className="font-medium text-stone-900">
                        #{format.number(trip.manifestId)} · {format.date(trip.tripDate)}
                      </div>
                      {trip.manifestNo && (
                        <div dir="ltr" className="font-mono text-[11px] text-stone-400">
                          {trip.manifestNo}
                        </div>
                      )}
                    </button>
                  </td>
                  <td>
                    <span dir="ltr" className="font-mono text-[11px] text-stone-500">
                      {trip.billId ?? '—'}
                    </span>
                  </td>
                  <td>
                    <bdi>{trip.companyName}</bdi>
                  </td>
                  <td>
                    <PlateBadge plate={trip.plateNumber} />
                  </td>
                  <td>
                    <RouteLabel
                      cities={cities}
                      originId={trip.originCityId}
                      destinationId={trip.destinationCityId}
                    />
                  </td>
                  <td className="text-end whitespace-nowrap tabular-nums">
                    {format.currency(trip.amount)}
                  </td>
                  <td>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ${STATUS_STYLES[trip.status]}`}
                    >
                      {t(`statuses.${trip.status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default GovtSearch
