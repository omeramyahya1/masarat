import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, LoaderCircle, Plus, Route } from 'lucide-react'
import {
  CARGO_TYPES,
  MANIFEST_STATUSES,
  TRIP_KINDS,
  tripCargoTypes,
  type FleetErrorCode,
  type TripRecord,
  type TripReferenceData
} from '@masarat/shared/fleet'
import type { AuthUser } from '@masarat/shared/auth'
import { parseDay } from '@masarat/shared/analytics'
import { plateSearchKey } from '@masarat/shared/plate'
import { useFormat } from '@masarat/ui/lib/format'
import { useListView, type ListViewConfig } from '@masarat/ui/lib/useListView'
import ListToolbar from '@masarat/ui/components/ui/ListToolbar'
import { FormAlert } from '@masarat/ui/components/form/fields'
import PlateBadge from '@masarat/ui/components/fleet/PlateBadge'
import TripDetails from '@masarat/ui/components/trips/TripDetails'
import TripForm from './TripForm'
import { STATUS_STYLES } from '@masarat/ui/components/trips/statusStyles'
import { api } from '@masarat/api-client'

function TripsPanel({
  owner,
  onGoToVehicles,
  onGoToProfile
}: {
  // The signed-in owner: their address and TIN are needed before a bill can be generated
  owner: AuthUser
  onGoToVehicles: () => void
  onGoToProfile: () => void
}): React.JSX.Element {
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

  // Search, filters, sort and grouping over the loaded trips
  const listConfig = useMemo<ListViewConfig<TripRecord>>(() => {
    const city = (id: number): string => format.city(reference?.cities.find((c) => c.id === id))
    const cityNames = (id: number): string => {
      const found = reference?.cities.find((c) => c.id === id)
      return `${found?.name ?? ''} ${found?.nameAr ?? ''}`
    }
    const route = (trip: TripRecord): string =>
      `${city(trip.originCityId)} ${format.isArabic ? '←' : '→'} ${city(trip.destinationCityId)}`
    const statusOrder = (trip: TripRecord): number => MANIFEST_STATUSES.indexOf(trip.status)
    const monthFormat = new Intl.DateTimeFormat(format.isArabic ? 'ar-SD-u-nu-latn' : 'en-US', {
      month: 'long',
      year: 'numeric'
    })
    return {
      storageKey: 'masarat.list.trips',
      defaultSort: 'tripDate',
      defaultDirection: 'desc',
      matches: (trip, query) => {
        const plate = plateSearchKey(query)
        if (plate.length >= 2 && plateSearchKey(trip.plateNumber).includes(plate)) return true
        return [
          `#${trip.id}`,
          cityNames(trip.originCityId),
          cityNames(trip.destinationCityId),
          trip.driverName ?? '',
          trip.shipper.name,
          trip.receiver.name,
          ...trip.items.map((item) => item.name)
        ].some((text) => text.toLowerCase().includes(query))
      },
      filters: {
        status: (trip, value) =>
          value === 'billed'
            ? trip.status === 'billed' || trip.status === 'paid'
            : trip.status === value,
        tripKind: (trip, value) => trip.tripKind === value,
        cargoType: (trip, value) => tripCargoTypes(trip).some((c) => c === value),
        vehicle: (trip, value) => String(trip.vehicleId) === value,
        driver: (trip, value) => String(trip.driverId ?? '') === value,
        from: (trip, value) => trip.tripDate >= (parseDay(value)?.getTime() ?? 0),
        to: (trip, value) => trip.tripDate <= (parseDay(value)?.getTime() ?? Infinity)
      },
      sorts: {
        tripDate: (a, b) => a.tripDate - b.tripDate || a.id - b.id,
        createdAt: (a, b) => a.createdAt - b.createdAt || a.id - b.id,
        amount: (a, b) => a.taxAmount - b.taxAmount,
        tripCost: (a, b) => a.tripCost - b.tripCost,
        distance: (a, b) => a.distanceKm - b.distanceKm,
        status: (a, b) => statusOrder(a) - statusOrder(b)
      },
      groups: {
        status: (trip) => ({
          key: trip.status,
          label: t(`statuses.${trip.status}`),
          order: statusOrder(trip)
        }),
        month: (trip) => {
          const date = new Date(trip.tripDate)
          return {
            key: `${date.getFullYear()}-${date.getMonth()}`,
            label: monthFormat.format(date),
            // Newest month first
            order: -(date.getFullYear() * 12 + date.getMonth())
          }
        },
        vehicle: (trip) => ({
          key: String(trip.vehicleId),
          label: format.plate(trip.plateNumber),
          order: trip.plateNumber
        }),
        driver: (trip) => ({
          key: String(trip.driverId ?? ''),
          label: trip.driverName ?? t('listView.noDriver'),
          order: trip.driverName ?? '\uffff'
        }),
        route: (trip) => ({
          key: `${trip.originCityId}-${trip.destinationCityId}`,
          label: route(trip),
          order: route(trip)
        }),
        tripKind: (trip) => ({
          key: trip.tripKind,
          label: t(`tripKinds.${trip.tripKind}`),
          order: TRIP_KINDS.indexOf(trip.tripKind)
        }),
        cargoType: (trip) => ({
          key: trip.cargoType,
          label: t(`cargoTypes.${trip.cargoType}`),
          order: CARGO_TYPES.indexOf(trip.cargoType)
        })
      }
    }
  }, [reference, format, t])
  const list = useListView(trips, listConfig)
  // Filter options from the trips themselves
  const vehicleOptions = useMemo(
    () =>
      [...new Map((trips ?? []).map((trip) => [trip.vehicleId, trip.plateNumber]))].map(
        ([id, plate]) => ({ value: String(id), label: format.plate(plate) })
      ),
    [trips, format]
  )
  const driverOptions = useMemo(
    () =>
      [
        ...new Map(
          (trips ?? []).flatMap((trip) =>
            trip.driverId && trip.driverName ? [[trip.driverId, trip.driverName] as const] : []
          )
        )
      ].map(([id, name]) => ({ value: String(id), label: name })),
    [trips]
  )
  const openTrip = (tripId: number): void => {
    setDeleted(null)
    setMode({ tripId })
  }

  const load = useCallback(async (): Promise<void> => {
    try {
      const [ref, list] = await Promise.all([api.trips.getReferenceData(), api.trips.list()])
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
        owner={owner}
        onGoToProfile={onGoToProfile}
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

  const row = (trip: TripRecord): React.JSX.Element => (
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
        <div>
          {tripCargoTypes(trip).length > 1 ? (
            <span title={format.list(tripCargoTypes(trip).map((c) => t(`cargoTypes.${c}`)))}>
              {t('trips.mixed')}
            </span>
          ) : (
            t(`cargoTypes.${trip.cargoType}`)
          )}
        </div>
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
  )

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
        <>
          <ListToolbar
            state={list.state}
            onChange={list.update}
            onReset={list.reset}
            searchPlaceholder={t('trips.list.search')}
            filters={[
              {
                key: 'status',
                label: t('trips.list.status'),
                options: (['draft', 'billed', 'certified'] as const).map((s) => ({
                  value: s,
                  label: t(`statuses.${s}`)
                }))
              },
              {
                key: 'tripKind',
                label: t('trips.fields.tripKind'),
                options: TRIP_KINDS.map((k) => ({ value: k, label: t(`tripKinds.${k}`) }))
              },
              {
                key: 'cargoType',
                label: t('trips.list.cargoType'),
                options: CARGO_TYPES.map((c) => ({ value: c, label: t(`cargoTypes.${c}`) }))
              },
              { key: 'vehicle', label: t('trips.list.vehicle'), options: vehicleOptions },
              { key: 'driver', label: t('trips.fields.driver'), options: driverOptions },
              { key: 'from', label: t('trips.list.from'), type: 'date' },
              { key: 'to', label: t('trips.list.to'), type: 'date' }
            ]}
            sorts={['tripDate', 'createdAt', 'amount', 'tripCost', 'distance', 'status'].map(
              (s) => ({
                value: s,
                label: t(`trips.list.sorts.${s}`)
              })
            )}
            groups={['status', 'month', 'vehicle', 'driver', 'route', 'tripKind', 'cargoType'].map(
              (g) => ({ value: g, label: t(`trips.list.groups.${g}`) })
            )}
            shown={list.visible.length}
            total={list.total}
          />
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
                {list.groups
                  ? list.groups.flatMap((group) => [
                      <tr key={`group-${group.key}`} className="bg-stone-50">
                        <th colSpan={7} className="text-start text-sm font-semibold text-stone-800">
                          <span className="me-3">{group.label}</span>
                          <span className="text-xs font-normal text-stone-500">
                            {t('trips.groupSummary', {
                              count: format.number(group.items.length),
                              total: format.currency(
                                group.items.reduce((sum, trip) => sum + trip.taxAmount, 0)
                              )
                            })}
                          </span>
                        </th>
                      </tr>,
                      ...group.items.map(row)
                    ])
                  : list.visible.map(row)}
              </tbody>
            </table>
            {list.visible.length === 0 && (
              <p className="py-10 text-center text-sm text-stone-500">{t('listView.noMatches')}</p>
            )}
          </div>
        </>
      )}
    </section>
  )
}

export default TripsPanel
