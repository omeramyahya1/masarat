import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, LoaderCircle, Plus, Route } from 'lucide-react'
import {
  CARGO_TYPES,
  TRIP_GROUPS,
  TRIP_KINDS,
  TRIP_SORTS,
  TRIP_STATUS_FILTERS,
  tripCargoTypes,
  type DriverRecord,
  type FleetErrorCode,
  type TripGroup,
  type TripListQuery,
  type TripRecord,
  type TripReferenceData,
  type VehicleRecord
} from '@masarat/shared/fleet'
import type { BranchRecord } from '@masarat/shared/members'
import { useAccount, useCan } from '@masarat/ui/lib/account'
import { useFormat } from '@masarat/ui/lib/format'
import { useServerList, type ServerListState } from '@masarat/ui/lib/useServerList'
import ListToolbar from '@masarat/ui/components/ui/ListToolbar'
import Pagination from '@masarat/ui/components/ui/Pagination'
import { FormAlert } from '@masarat/ui/components/form/fields'
import PlateBadge from '@masarat/ui/components/fleet/PlateBadge'
import TripDetails from '@masarat/ui/components/trips/TripDetails'
import TripForm from './TripForm'
import { STATUS_STYLES } from '@masarat/ui/components/trips/statusStyles'
import { api } from '@masarat/api-client'

// The company's trips; a branch member's are their branch's (the API decides which)
function TripsPanel({
  onGoToVehicles,
  onGoToCompany
}: {
  onGoToVehicles: () => void
  // The company's address and TIN are needed before a bill can be generated
  onGoToCompany: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const can = useCan()
  const { role } = useAccount()
  // Only members who see every branch can filter or group by branch
  const allBranches = role.scope === 'company'
  const [mode, setMode] = useState<'list' | 'new' | { tripId: number } | { editing: TripRecord }>(
    'list'
  )
  const [reference, setReference] = useState<TripReferenceData | null>(null)
  // For the filters and the group headers
  const [vehicles, setVehicles] = useState<VehicleRecord[]>([])
  const [drivers, setDrivers] = useState<DriverRecord[]>([])
  const [branches, setBranches] = useState<BranchRecord[]>([])
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [created, setCreated] = useState<TripRecord | null>(null)
  const [deleted, setDeleted] = useState<number | null>(null)

  // Search, filters, sort and grouping, applied by the API one page at a time
  const fetchTrips = useCallback(
    (state: ServerListState) => {
      const f = state.filters
      const query: TripListQuery = {
        page: state.page,
        pageSize: state.pageSize,
        query: state.query.trim() || undefined,
        status: (f.status || undefined) as TripListQuery['status'],
        tripKind: (f.tripKind || undefined) as TripListQuery['tripKind'],
        cargoType: (f.cargoType || undefined) as TripListQuery['cargoType'],
        vehicleId: f.vehicle ? Number(f.vehicle) : undefined,
        driverId: f.driver ? Number(f.driver) : undefined,
        branchId: f.branch ? Number(f.branch) : undefined,
        from: f.from || undefined,
        to: f.to || undefined,
        sort: state.sort as TripListQuery['sort'],
        direction: state.direction,
        group: (state.group || undefined) as TripGroup | undefined,
        lang: format.isArabic ? 'ar' : 'en'
      }
      return api.trips.list(query)
    },
    [format.isArabic]
  )
  const list = useServerList(fetchTrips, {
    storageKey: 'masarat.list.trips',
    defaultSort: 'tripDate',
    defaultDirection: 'desc'
  })
  const page = list.data

  const cityById = (id: number): TripReferenceData['cities'][number] | undefined =>
    reference?.cities.find((c) => c.id === id)

  // A group header's label, from its key (see services/tripList.ts)
  const monthFormat = new Intl.DateTimeFormat(format.isArabic ? 'ar-SD-u-nu-latn' : 'en-US', {
    month: 'long',
    year: 'numeric'
  })
  const groupLabel = (group: TripGroup, key: string): string => {
    switch (group) {
      case 'status':
        return t(`statuses.${key}`)
      case 'month': {
        const [year, month] = key.split('-').map(Number)
        return monthFormat.format(new Date(year, month - 1, 1))
      }
      case 'vehicle': {
        const vehicle = vehicles.find((v) => String(v.id) === key)
        return vehicle ? format.plate(vehicle.plateNumber) : key
      }
      case 'driver':
        return key
          ? (drivers.find((d) => String(d.id) === key)?.name ?? t('listView.noDriver'))
          : t('listView.noDriver')
      case 'route': {
        const [from, to] = key.split('-').map(Number)
        return `${format.city(cityById(from))} ${format.isArabic ? '←' : '→'} ${format.city(cityById(to))}`
      }
      case 'tripKind':
        return t(`tripKinds.${key}`)
      case 'cargoType':
        return t(`cargoTypes.${key}`)
      case 'branch':
        return branches.find((b) => String(b.id) === key)?.name ?? key
    }
  }

  const openTrip = (tripId: number): void => {
    setDeleted(null)
    setMode({ tripId })
  }

  const loadLists = useCallback(async (): Promise<void> => {
    try {
      const [ref, vehicleList, driverList, branchList] = await Promise.all([
        api.trips.getReferenceData(),
        api.fleet.listVehicles(),
        api.fleet.listDrivers(),
        api.company.branches()
      ])
      if (!ref.ok) return setError(ref.error)
      setReference(ref.data)
      if (vehicleList.ok) setVehicles(vehicleList.data)
      if (driverList.ok) setDrivers(driverList.data)
      if (branchList.ok) setBranches(branchList.data)
    } catch {
      setError('unknown')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    loadLists()
  }, [loadLists])

  // After a trip was saved, deleted or billed
  const load = (): void => {
    list.reload()
    void loadLists()
  }

  if (typeof mode === 'object' && 'tripId' in mode && reference) {
    return (
      <TripDetails
        key={mode.tripId}
        tripId={mode.tripId}
        reference={reference}
        onGoToCompany={onGoToCompany}
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
          branches={branches}
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
        {page && page.overall > 0 && can('trips.edit') && (
          <button type="button" className="btn btn-primary" onClick={startNew}>
            <Plus size={16} />
            {t('trips.new')}
          </button>
        )}
      </div>

      {(error ?? list.error) && <FormAlert message={t(`fleet.errors.${error ?? list.error}`)} />}
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

      {page === null ? (
        !error &&
        !list.error && (
          <div className="flex justify-center py-16 text-stone-400">
            <LoaderCircle className="animate-spin" />
          </div>
        )
      ) : page.overall === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <Route size={24} />
          </div>
          <h3 className="font-semibold text-stone-900">{t('trips.empty.title')}</h3>
          <p className="max-w-sm text-sm text-stone-500">{t('trips.empty.body')}</p>
          {can('trips.edit') && (
            <button type="button" className="btn btn-primary mt-2" onClick={startNew}>
              <Plus size={16} />
              {t('trips.new')}
            </button>
          )}
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
                options: TRIP_STATUS_FILTERS.map((s) => ({
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
              {
                key: 'vehicle',
                label: t('trips.list.vehicle'),
                options: vehicles.map((v) => ({
                  value: String(v.id),
                  label: format.plate(v.plateNumber)
                }))
              },
              {
                key: 'driver',
                label: t('trips.fields.driver'),
                options: drivers.map((d) => ({ value: String(d.id), label: d.name }))
              },
              ...(allBranches
                ? [
                    {
                      key: 'branch',
                      label: t('trips.list.branch'),
                      options: branches.map((b) => ({ value: String(b.id), label: b.name }))
                    }
                  ]
                : []),
              { key: 'from', label: t('trips.list.from'), type: 'date' },
              { key: 'to', label: t('trips.list.to'), type: 'date' }
            ]}
            sorts={TRIP_SORTS.map((s) => ({
              value: s,
              label: t(`trips.list.sorts.${s}`)
            }))}
            groups={TRIP_GROUPS.filter((g) => allBranches || g !== 'branch').map((g) => ({
              value: g,
              label: t(`trips.list.groups.${g}`)
            }))}
            shown={page.total}
            total={page.overall}
          />
          <div
            className={`card overflow-x-auto transition-opacity ${list.loading ? 'opacity-60' : ''}`}
            aria-busy={list.loading}
          >
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
                {page.rows.flatMap((trip, index) => {
                  // A group's header goes above its first row on this page; its count and total
                  // are for the whole group
                  const key = trip.groupKey
                  const group =
                    key === undefined ? undefined : page.groups?.find((g) => g.key === key)
                  const first = index === 0 || page.rows[index - 1].groupKey !== key
                  if (!group || !first || !list.state.group) return [row(trip)]
                  return [
                    <tr key={`group-${key}`} className="bg-stone-50">
                      <th colSpan={7} className="text-start text-sm font-semibold text-stone-800">
                        <span className="me-3">
                          {groupLabel(list.state.group as TripGroup, group.key)}
                        </span>
                        <span className="text-xs font-normal text-stone-500">
                          {t('trips.groupSummary', {
                            count: format.number(group.count),
                            total: format.currency(group.totalDue)
                          })}
                        </span>
                      </th>
                    </tr>,
                    row(trip)
                  ]
                })}
              </tbody>
            </table>
            {page.rows.length === 0 && (
              <p className="py-10 text-center text-sm text-stone-500">{t('listView.noMatches')}</p>
            )}
          </div>
          <Pagination
            page={page.page}
            pageSize={page.pageSize}
            total={page.total}
            onPage={list.setPage}
            onPageSize={list.setPageSize}
          />
        </>
      )}
    </section>
  )
}

export default TripsPanel
