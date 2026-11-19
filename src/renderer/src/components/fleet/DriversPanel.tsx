import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, Pencil, Plus, Trash2, UsersRound } from 'lucide-react'
import type { DriverRecord, FleetErrorCode } from '../../../../shared/fleet'
import { useFormat } from '../../lib/format'
import { useListView, type ListViewConfig } from '../../lib/useListView'
import { FormAlert } from '../form/fields'
import ListToolbar from '../ui/ListToolbar'
import Modal from '../ui/Modal'
import DriverDialog from './DriverDialog'

// The fleet owner's drivers, picked on each trip
function DriversPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const [drivers, setDrivers] = useState<DriverRecord[] | null>(null)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  // 'new' opens the add dialog; a record opens it for editing
  const [editing, setEditing] = useState<DriverRecord | 'new' | null>(null)
  const [deleting, setDeleting] = useState<DriverRecord | null>(null)
  const format = useFormat()

  // Search and sort over the loaded drivers (drivers aren't grouped)
  const listConfig = useMemo<ListViewConfig<DriverRecord>>(
    () => ({
      storageKey: 'masarat.list.drivers',
      defaultSort: 'name',
      defaultDirection: 'asc',
      matches: (driver, query) =>
        driver.name.toLowerCase().includes(query) ||
        driver.phone.includes(query.replace(/[\s-]/g, '')),
      filters: {},
      sorts: {
        name: (a, b) => a.name.localeCompare(b.name, 'ar'),
        trips: (a, b) => a.tripCount - b.tripCount,
        createdAt: (a, b) => a.createdAt - b.createdAt || a.id - b.id
      }
    }),
    []
  )
  const list = useListView(drivers, listConfig)

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await window.api.fleet.listDrivers()
      if (result.ok) setDrivers(result.data)
      else setError(result.error)
    } catch {
      setError('unknown')
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    load()
  }, [load])

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">{t('drivers.title')}</h2>
          <p className="text-sm text-stone-500">{t('drivers.subtitle')}</p>
        </div>
        {drivers && drivers.length > 0 && (
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <Plus size={16} />
            {t('drivers.add')}
          </button>
        )}
      </div>

      {error && <FormAlert message={t(`fleet.errors.${error}`)} />}

      {drivers === null ? (
        !error && (
          <div className="flex justify-center py-16 text-stone-400">
            <LoaderCircle className="animate-spin" />
          </div>
        )
      ) : drivers.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <UsersRound size={24} />
          </div>
          <h3 className="font-semibold text-stone-900">{t('drivers.empty.title')}</h3>
          <p className="max-w-sm text-sm text-stone-500">{t('drivers.empty.body')}</p>
          <button type="button" className="btn btn-primary mt-2" onClick={() => setEditing('new')}>
            <Plus size={16} />
            {t('drivers.add')}
          </button>
        </div>
      ) : (
        <>
          <ListToolbar
            state={list.state}
            onChange={list.update}
            onReset={list.reset}
            searchPlaceholder={t('drivers.list.search')}
            filters={[]}
            sorts={['name', 'trips', 'createdAt'].map((s) => ({
              value: s,
              label: t(`drivers.list.sorts.${s}`)
            }))}
            shown={list.visible.length}
            total={list.total}
          />
          <div className="card overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('drivers.columns.name')}</th>
                  <th>{t('drivers.columns.phone')}</th>
                  <th>{t('drivers.columns.trips')}</th>
                  <th className="w-0">
                    <span className="sr-only">{t('common.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.visible.map((driver) => (
                  <tr key={driver.id}>
                    <td className="font-medium text-stone-900">
                      <bdi>{driver.name}</bdi>
                    </td>
                    <td>
                      <bdi className="tabular-nums" dir="ltr">
                        {driver.phone}
                      </bdi>
                    </td>
                    <td className="tabular-nums">{format.number(driver.tripCount)}</td>
                    <td>
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="icon-btn"
                          title={t('drivers.edit')}
                          aria-label={t('drivers.editName', { name: driver.name })}
                          onClick={() => setEditing(driver)}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn hover:text-red-700"
                          title={t('drivers.delete')}
                          aria-label={t('drivers.deleteName', { name: driver.name })}
                          onClick={() => setDeleting(driver)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.visible.length === 0 && (
              <p className="py-10 text-center text-sm text-stone-500">{t('listView.noMatches')}</p>
            )}
          </div>
        </>
      )}

      {editing && (
        <DriverDialog
          driver={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
      {deleting && (
        <DeleteDriverDialog
          driver={deleting}
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

function DeleteDriverDialog({
  driver,
  onClose,
  onDeleted
}: {
  driver: DriverRecord
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
      const result = await window.api.fleet.deleteDriver(driver.id)
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
        {t('drivers.deleteDialog.title')}
      </h2>
      <div className="mt-2 flex flex-col gap-3 text-sm text-stone-600">
        <p className="font-medium text-stone-900">
          <bdi>{driver.name}</bdi>
        </p>
        <p>{t('drivers.deleteDialog.body')}</p>
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
          {t('drivers.delete')}
        </button>
      </div>
    </Modal>
  )
}

export default DriversPanel
