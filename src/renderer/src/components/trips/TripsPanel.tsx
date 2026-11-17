import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, LoaderCircle, Plus, Route } from 'lucide-react'
import type { FleetErrorCode, TripRecord, TripReferenceData } from '../../../../shared/fleet'
import { useFormat } from '../../lib/format'
import { FormAlert } from '../form/fields'
import PlateBadge from '../fleet/PlateBadge'
import TripDetails from './TripDetails'
import TripForm from './TripForm'
import { STATUS_STYLES } from './statusStyles'

function TripsPanel({ onGoToVehicles }: { onGoToVehicles: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const [mode, setMode] = useState<'list' | 'new' | { tripId: number } | { editing: TripRecord }>(
    'list'
  )
  const [reference, setReference] = useState<TripReferenceData | null>(null)
  const [trips, setTrips] = useState<TripRecord[] | null>(null)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [created, setCreated] = useState<TripRecord | null>(null)
  const [deleted, setDeleted] = useState<number | null>(null)
  const openTrip = (tripId: number): void => {
    setDeleted(null)
    setMode({ tripId })
  }

  const load = useCallback(async (): Promise<void> => {
    try {
      const [ref, list] = await Promise.all([
        window.api.trips.getReferenceData(),
        window.api.trips.list()
      ])
      if (!ref.ok) return setError(ref.error)
      if (!list.ok) return setError(list.error)
      setReference(ref.data)
      setTrips(list.data)
    } catch {
      setError('unknown')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    load()
  }, [load])

  const cityById = (id: number): TripReferenceData['cities'][number] | undefined =>
    reference?.cities.find((c) => c.id === id)

  if (typeof mode === 'object' && 'tripId' in mode && reference) {
    return (
      <TripDetails
        key={mode.tripId}
        tripId={mode.tripId}
        reference={reference}
        onBack={() => setMode('list')}
        onEdit={(trip) => setMode({ editing: trip })}
        onDeleted={() => {
          setCreated(null)
          setDeleted(mode.tripId)
          setMode('list')
          load()
        }}
        onChanged={load}
      />
    )
  }

  if ((mode === 'new' || (typeof mode === 'object' && 'editing' in mode)) && reference) {
    const editing = mode === 'new' ? undefined : mode.editing
    // Editing returns to the trip it came from; a new trip returns to the list
    const leave = (): void => (editing ? openTrip(editing.id) : setMode('list'))
    return (
      <section className="flex flex-col gap-4">
        <div>
          <button
            type="button"
            className="link inline-flex items-center gap-1 text-sm"
            onClick={leave}
          >
            <ArrowLeft size={14} className="rtl:-scale-x-100" />
            {editing ? t('trips.backToTrip') : t('trips.backToList')}
          </button>
          <h2 className="mt-2 text-lg font-semibold text-stone-900">
            {editing
              ? t('trips.form.editTitle', { id: format.number(editing.id) })
              : t('trips.form.title')}
          </h2>
          <p className="text-sm text-stone-500">
            {editing ? t('trips.form.editSubtitle') : t('trips.form.subtitle')}
          </p>
        </div>
        <TripForm
          key={editing?.id ?? 'new'}
          reference={reference}
          trip={editing}
          onCancel={leave}
          onGoToVehicles={onGoToVehicles}
          onSaved={(trip) => {
            // The next step is paying the trip's taxes, so go straight to its details
            if (!editing) setCreated(trip)
            openTrip(trip.id)
            load()
          }}
        />
      </section>
    )
  }

  const startNew = (): void => {
    setCreated(null)
    setDeleted(null)
    setMode('new')
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">{t('trips.title')}</h2>
          <p className="text-sm text-stone-500">{t('trips.subtitle')}</p>
        </div>
        {trips && trips.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={startNew}>
            <Plus size={16} />
            {t('trips.new')}
          </button>
        )}
      </div>

      {error && <FormAlert message={t(`fleet.errors.${error}`)} />}
      {deleted !== null && (
        <FormAlert tone="success" message={t('trips.deleted', { id: format.number(deleted) })} />
      )}
      {created && (
        <FormAlert
          tone="success"
          message={t('trips.created', {
            plate: format.plate(created.plateNumber),
            amount: format.currency(created.taxAmount)
          })}
        />
      )}

      {trips === null ? (
        !error && (
          <div className="flex justify-center py-16 text-stone-400">
            <LoaderCircle className="animate-spin" />
          </div>
        )
      ) : trips.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <Route size={24} />
          </div>
          <h3 className="font-semibold text-stone-900">{t('trips.empty.title')}</h3>
          <p className="max-w-sm text-sm text-stone-500">{t('trips.empty.body')}</p>
          <button type="button" className="btn btn-primary mt-2" onClick={startNew}>
            <Plus size={16} />
            {t('trips.new')}
          </button>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('trips.columns.date')}</th>
                <th>{t('trips.columns.vehicle')}</th>
                <th>{t('trips.columns.route')}</th>
                <th>{t('trips.columns.cargo')}</th>
                <th>{t('trips.columns.distance')}</th>
                <th className="text-end">{t('trips.columns.tax')}</th>
                <th>{t('trips.columns.status')}</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((trip) => (
                <tr
                  key={trip.id}
                  className={`cursor-pointer hover:bg-stone-50 ${trip.id === created?.id ? 'bg-brand-50/60' : ''}`}
                  onClick={() => openTrip(trip.id)}
                >
                  <td className="whitespace-nowrap">
                    {/* Keyboard access to the row; the row itself handles mouse clicks */}
                    <button
                      type="button"
                      className="text-start hover:underline"
                      aria-label={`${t('trips.open')}: ${format.date(trip.tripDate)}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        openTrip(trip.id)
                      }}
                    >
                      {format.date(trip.tripDate)}
                    </button>
                  </td>
                  <td>
                    <PlateBadge plate={trip.plateNumber} />
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      {format.city(cityById(trip.originCityId))}
                      <ArrowRight size={14} className="text-stone-400 rtl:-scale-x-100" />
                      {format.city(cityById(trip.destinationCityId))}
                    </span>
                  </td>
                  <td>
                    <div>{t(`cargoTypes.${trip.cargoType}`)}</div>
                    <div className="text-xs text-stone-500 tabular-nums">
                      {format.quantity(trip.cargoQuantity, trip.cargoUnit)}
                    </div>
                  </td>
                  <td className="whitespace-nowrap tabular-nums">
                    {t('units.km', { value: format.number(trip.distanceKm) })}
                  </td>
                  <td className="text-end font-medium whitespace-nowrap tabular-nums">
                    {format.currency(trip.taxAmount)}
                  </td>
                  <td>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLES[trip.status]}`}
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

export default TripsPanel
