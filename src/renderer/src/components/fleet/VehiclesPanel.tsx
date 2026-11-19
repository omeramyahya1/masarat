import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, Pencil, Plus, Trash2, Truck } from 'lucide-react'
import {
  QUANTITY_UNITS,
  VEHICLE_TYPES,
  type FleetErrorCode,
  type VehicleRecord
} from '../../../../shared/fleet'
import { plateSearchKey } from '../../../../shared/plate'
import { useListView, type ListViewConfig } from '../../lib/useListView'
import ListToolbar from '../ui/ListToolbar'
import { useFormat } from '../../lib/format'
import { FormAlert } from '../form/fields'
import Modal from '../ui/Modal'
import PlateBadge from './PlateBadge'
import VehicleDialog from './VehicleDialog'

function VehiclesPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const [vehicles, setVehicles] = useState<VehicleRecord[] | null>(null)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  // 'new' opens the add dialog; a record opens it for editing
  const [editing, setEditing] = useState<VehicleRecord | 'new' | null>(null)
  const [deleting, setDeleting] = useState<VehicleRecord | null>(null)

  // Search, filters, sort and grouping over the loaded vehicles
  const listConfig = useMemo<ListViewConfig<VehicleRecord>>(
    () => ({
      storageKey: 'masarat.list.vehicles',
      defaultSort: 'createdAt',
      defaultDirection: 'asc',
      matches: (vehicle, query) => {
        const plate = plateSearchKey(query)
        return (
          (plate.length >= 1 && plateSearchKey(vehicle.plateNumber).includes(plate)) ||
          (vehicle.registrationNo ?? '').toLowerCase().includes(query)
        )
      },
      filters: {
        type: (vehicle, value) => vehicle.vehicleType === value,
        unit: (vehicle, value) => vehicle.capacityUnit === value,
        registration: (vehicle, value) =>
          value === 'missing' ? !vehicle.registrationNo : Boolean(vehicle.registrationNo)
      },
      sorts: {
        plate: (a, b) => a.plateNumber.localeCompare(b.plateNumber),
        type: (a, b) =>
          t(`vehicleTypes.${a.vehicleType}`).localeCompare(t(`vehicleTypes.${b.vehicleType}`)),
        capacity: (a, b) => a.capacity - b.capacity,
        trips: (a, b) => a.tripCount - b.tripCount,
        createdAt: (a, b) => a.createdAt - b.createdAt || a.id - b.id
      },
      groups: {
        type: (vehicle) => ({
          key: vehicle.vehicleType,
          label: t(`vehicleTypes.${vehicle.vehicleType}`),
          order: VEHICLE_TYPES.indexOf(vehicle.vehicleType)
        }),
        unit: (vehicle) => ({
          key: vehicle.capacityUnit,
          label: t(`units.name.${vehicle.capacityUnit}`),
          order: QUANTITY_UNITS.indexOf(vehicle.capacityUnit)
        })
      }
    }),
    [t]
  )
  const list = useListView(vehicles, listConfig)

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await window.api.fleet.listVehicles()
      if (result.ok) setVehicles(result.data)
      else setError(result.error)
    } catch {
      setError('unknown')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    load()
  }, [load])

  const handleSaved = (): void => {
    setEditing(null)
    load()
  }

  const row = (vehicle: VehicleRecord): React.JSX.Element => (
    <tr key={vehicle.id}>
      <td>
        <PlateBadge plate={vehicle.plateNumber} />
      </td>
      <td>
        {vehicle.registrationNo ? (
          <bdi className="font-mono text-xs">{vehicle.registrationNo}</bdi>
        ) : (
          <span className="text-amber-700">{t('fleet.missingRegistration')}</span>
        )}
      </td>
      <td>{t(`vehicleTypes.${vehicle.vehicleType}`)}</td>
      <td className="tabular-nums">{format.quantity(vehicle.capacity, vehicle.capacityUnit)}</td>
      <td className="tabular-nums">{format.number(vehicle.tripCount)}</td>
      <td>
        <div className="flex justify-end gap-1">
          <button
            type="button"
            className="icon-btn"
            title={t('fleet.edit')}
            aria-label={t('fleet.editPlate', {
              plate: format.plate(vehicle.plateNumber)
            })}
            onClick={() => setEditing(vehicle)}
          >
            <Pencil size={16} />
          </button>
          <button
            type="button"
            className="icon-btn hover:text-red-700"
            title={vehicle.tripCount > 0 ? t('fleet.errors.vehicle_in_use') : t('fleet.delete')}
            aria-label={t('fleet.deletePlate', {
              plate: format.plate(vehicle.plateNumber)
            })}
            disabled={vehicle.tripCount > 0}
            onClick={() => setDeleting(vehicle)}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  )

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">{t('fleet.title')}</h2>
          <p className="text-sm text-stone-500">{t('fleet.subtitle')}</p>
        </div>
        {vehicles && vehicles.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <Plus size={16} />
            {t('fleet.add')}
          </button>
        )}
      </div>

      {error && <FormAlert message={t(`fleet.errors.${error}`)} />}

      {vehicles === null ? (
        !error && (
          <div className="flex justify-center py-16 text-stone-400">
            <LoaderCircle className="animate-spin" />
          </div>
        )
      ) : vehicles.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <Truck size={24} />
          </div>
          <h3 className="font-semibold text-stone-900">{t('fleet.empty.title')}</h3>
          <p className="max-w-sm text-sm text-stone-500">{t('fleet.empty.body')}</p>
          <button type="button" className="btn btn-primary mt-2" onClick={() => setEditing('new')}>
            <Plus size={16} />
            {t('fleet.add')}
          </button>
        </div>
      ) : (
        <>
          <ListToolbar
            state={list.state}
            onChange={list.update}
            onReset={list.reset}
            searchPlaceholder={t('fleet.list.search')}
            filters={[
              {
                key: 'type',
                label: t('fleet.columns.type'),
                options: VEHICLE_TYPES.map((v) => ({ value: v, label: t(`vehicleTypes.${v}`) }))
              },
              {
                key: 'unit',
                label: t('fleet.fields.capacityUnit'),
                options: QUANTITY_UNITS.map((u) => ({ value: u, label: t(`units.name.${u}`) }))
              },
              {
                key: 'registration',
                label: t('fleet.columns.registrationNo'),
                options: [
                  { value: 'present', label: t('fleet.list.registrationPresent') },
                  { value: 'missing', label: t('fleet.list.registrationMissing') }
                ]
              }
            ]}
            sorts={['createdAt', 'plate', 'type', 'capacity', 'trips'].map((s) => ({
              value: s,
              label: t(`fleet.list.sorts.${s}`)
            }))}
            groups={['type', 'unit'].map((g) => ({ value: g, label: t(`fleet.list.groups.${g}`) }))}
            shown={list.visible.length}
            total={list.total}
          />
          <div className="card overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('fleet.columns.plate')}</th>
                  <th>{t('fleet.columns.registrationNo')}</th>
                  <th>{t('fleet.columns.type')}</th>
                  <th>{t('fleet.columns.capacity')}</th>
                  <th>{t('fleet.columns.trips')}</th>
                  <th className="w-0">
                    <span className="sr-only">{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.groups
                  ? list.groups.flatMap((group) => [
                      <tr key={`group-${group.key}`} className="bg-stone-50">
                        <th colSpan={6} className="text-start text-sm font-semibold text-stone-800">
                          <span className="me-3">{group.label}</span>
                          <span className="text-xs font-normal text-stone-500">
                            {t('fleet.groupSummary', { count: format.number(group.items.length) })}
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

      {editing && (
        <VehicleDialog
          vehicle={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={handleSaved}
        />
      )}
      {deleting && (
        <DeleteVehicleDialog
          vehicle={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null)
            load()
          }}
        />
      )}
    </section>
  )
}

function DeleteVehicleDialog({
  vehicle,
  onClose,
  onDeleted
}: {
  vehicle: VehicleRecord
  onClose: () => void
  onDeleted: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const titleId = useId()
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [pending, setPending] = useState(false)

  const handleDelete = async (): Promise<void> => {
    setPending(true)
    try {
      const result = await window.api.fleet.deleteVehicle(vehicle.id)
      if (result.ok) onDeleted()
      else setError(result.error)
    } catch {
      setError('unknown')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal labelledBy={titleId} onClose={onClose} className="max-w-sm">
      <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-red-50 text-red-700">
        <Trash2 size={20} />
      </div>
      <h2 id={titleId} className="text-base font-semibold">
        {t('fleet.deleteDialog.title')}
      </h2>
      <div className="mt-2 flex flex-col gap-3 text-sm text-stone-600">
        <PlateBadge plate={vehicle.plateNumber} />
        <p>{t('fleet.deleteDialog.body')}</p>
        {error && <FormAlert message={t(`fleet.errors.${error}`)} />}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={pending}
          onClick={handleDelete}
        >
          {pending && <LoaderCircle size={16} className="animate-spin" />}
          {t('fleet.delete')}
        </button>
      </div>
    </Modal>
  )
}

export default VehiclesPanel
