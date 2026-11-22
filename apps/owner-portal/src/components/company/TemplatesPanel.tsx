import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Bus, LoaderCircle, Pencil, Plus, Trash2 } from 'lucide-react'
import type {
  DriverRecord,
  FleetErrorCode,
  TripReferenceData,
  VehicleRecord
} from '@masarat/shared/fleet'
import type { BranchRecord } from '@masarat/shared/members'
import {
  MAX_TEMPLATE_NAME_LENGTH,
  type TemplateInput,
  type TemplateRecord
} from '@masarat/shared/templates'
import { FieldLabel, FormAlert, SelectField, TextField } from '@masarat/ui/components/form/fields'
import Modal from '@masarat/ui/components/ui/Modal'
import { useAccount } from '@masarat/ui/lib/account'
import { useFormat } from '@masarat/ui/lib/format'
import { useMountedRef } from '@masarat/ui/lib/useMountedRef'
import { api } from '@masarat/api-client'

interface Lists {
  cities: TripReferenceData['cities']
  buses: VehicleRecord[]
  drivers: DriverRecord[]
  branches: readonly BranchRecord[]
}

// "12:30" ↔ minutes, for the duration field
const durationText = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const parseDuration = (text: string): number | null => {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(text)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

function TemplateDialog({
  template,
  lists,
  onClose,
  onSaved
}: {
  template: TemplateRecord | null
  lists: Lists
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const titleId = useId()
  const timeId = useId()
  const durationId = useId()
  const mounted = useMountedRef()
  const ownBranch = useAccount().branch
  const [name, setName] = useState(template?.name ?? '')
  const [branchId, setBranchId] = useState(
    String(template?.branchId ?? ownBranch?.id ?? lists.branches.find((b) => b.active)?.id ?? '')
  )
  const [originId, setOriginId] = useState(template ? String(template.originCityId) : '')
  const [destinationId, setDestinationId] = useState(
    template ? String(template.destinationCityId) : ''
  )
  const [vehicleId, setVehicleId] = useState(template ? String(template.vehicleId) : '')
  const [driverId, setDriverId] = useState(template?.driverId ? String(template.driverId) : '')
  const [departureTime, setDepartureTime] = useState(template?.departureTime ?? '07:00')
  const [duration, setDuration] = useState(
    template ? durationText(template.durationMinutes) : '10:00'
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const cityOptions = useMemo(
    () =>
      lists.cities
        .map((c) => ({ value: String(c.id), label: format.city(c) }))
        .sort((a, b) => a.label.localeCompare(b.label, format.isArabic ? 'ar' : 'en')),
    [lists.cities, format]
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const durationMinutes = parseDuration(duration)
    if (!name.trim() || !originId || !destinationId || !vehicleId || !branchId) {
      return setError('missing_fields')
    }
    if (!durationMinutes) return setError('invalid_template')
    const input: TemplateInput = {
      name,
      branchId: Number(branchId),
      originCityId: Number(originId),
      destinationCityId: Number(destinationId),
      vehicleId: Number(vehicleId),
      driverId: driverId ? Number(driverId) : null,
      departureTime,
      durationMinutes
    }
    setPending(true)
    setError(null)
    try {
      const result = template
        ? await api.templates.update(template.id, input)
        : await api.templates.create(input)
      if (result.ok) return onSaved()
      if (mounted.current) setError(result.error)
    } catch {
      if (mounted.current) setError('unknown')
    }
    if (mounted.current) setPending(false)
  }

  return (
    <Modal labelledBy={titleId} className="max-w-lg" onClose={() => !pending && onClose()}>
      <h2 id={titleId} className="mb-4 text-lg font-semibold">
        {t(template ? 'templates.form.editTitle' : 'templates.form.title')}
      </h2>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {error && <FormAlert message={t(`fleet.errors.${error}`)} />}
        <TextField
          label={t('templates.form.name')}
          hint={t('templates.form.nameHint')}
          maxLength={MAX_TEMPLATE_NAME_LENGTH}
          dir="auto"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {!ownBranch && (
          <SelectField
            label={t('trips.fields.branch')}
            placeholder={t('trips.fields.branchPlaceholder')}
            value={branchId}
            options={lists.branches
              .filter((b) => b.active || String(b.id) === branchId)
              .map((b) => ({ value: String(b.id), label: b.name }))}
            onChange={(e) => setBranchId(e.target.value)}
          />
        )}
        <div className="grid grid-cols-2 gap-4">
          <SelectField
            label={t('trips.fields.origin')}
            placeholder={t('trips.fields.cityPlaceholder')}
            value={originId}
            options={cityOptions}
            onChange={(e) => setOriginId(e.target.value)}
          />
          <SelectField
            label={t('trips.fields.destination')}
            placeholder={t('trips.fields.cityPlaceholder')}
            value={destinationId}
            options={cityOptions.filter((c) => c.value !== originId)}
            onChange={(e) => setDestinationId(e.target.value)}
          />
        </div>
        <SelectField
          label={t('templates.form.bus')}
          placeholder={t(
            lists.buses.length > 0 ? 'templates.form.busPlaceholder' : 'templates.form.noBuses'
          )}
          value={vehicleId}
          options={lists.buses.map((v) => ({
            value: String(v.id),
            label: `${format.plate(v.plateNumber)} · ${format.quantity(v.capacity, v.capacityUnit)}`
          }))}
          onChange={(e) => setVehicleId(e.target.value)}
        />
        <SelectField
          label={t('trips.fields.driver')}
          placeholder={t('templates.form.noDriver')}
          value={driverId}
          options={[
            { value: '', label: t('templates.form.noDriver') },
            ...lists.drivers.map((d) => ({ value: String(d.id), label: d.name }))
          ]}
          onChange={(e) => setDriverId(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={timeId} label={t('templates.form.departureTime')} />
            <input
              id={timeId}
              type="time"
              className="input"
              value={departureTime}
              onChange={(e) => setDepartureTime(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <FieldLabel htmlFor={durationId} label={t('templates.form.duration')} />
            <input
              id={durationId}
              className="input tabular-nums"
              dir="ltr"
              placeholder="10:00"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
            <p className="field-hint">{t('templates.form.durationHint')}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending && <LoaderCircle size={16} className="animate-spin" />}
            {t('templates.form.save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// The company's passenger trip templates: a route, a bus, a driver, the time it leaves and how
// long it takes. "New trip from a template" in Trips starts from one.
function TemplatesPanel({ branches }: { branches: readonly BranchRecord[] }): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const mounted = useMountedRef()
  const [templates, setTemplates] = useState<TemplateRecord[] | null>(null)
  const [lists, setLists] = useState<Omit<Lists, 'branches'> | null>(null)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [editing, setEditing] = useState<TemplateRecord | 'new' | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    Promise.all([
      api.templates.list(),
      api.trips.getReferenceData(),
      api.fleet.listVehicles(),
      api.fleet.listDrivers()
    ])
      .then(([list, reference, vehicles, drivers]) => {
        if (!mounted.current) return
        if (!list.ok) return setError(list.error)
        setTemplates(list.data)
        setLists({
          cities: reference.ok ? reference.data.cities : [],
          buses: vehicles.ok ? vehicles.data.filter((v) => v.vehicleType === 'bus') : [],
          drivers: drivers.ok ? drivers.data : []
        })
      })
      .catch(() => mounted.current && setError('unknown'))
  }, [mounted, version])

  const remove = async (template: TemplateRecord): Promise<void> => {
    const result = await api.templates.delete(template.id)
    if (!mounted.current) return
    if (!result.ok) return setError(result.error)
    setVersion((v) => v + 1)
  }

  const city = (id: number): string => format.city(lists?.cities.find((c) => c.id === id))

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">{t('templates.title')}</h2>
          <p className="max-w-2xl text-sm text-stone-500">{t('templates.subtitle')}</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!lists}
          onClick={() => setEditing('new')}
        >
          <Plus size={16} />
          {t('templates.add')}
        </button>
      </div>

      {error && <FormAlert message={t(`fleet.errors.${error}`)} />}

      {templates === null ? (
        !error && (
          <div className="flex justify-center py-16 text-stone-400">
            <LoaderCircle className="animate-spin" />
          </div>
        )
      ) : templates.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <Bus size={24} />
          </div>
          <h3 className="font-semibold text-stone-900">{t('templates.empty.title')}</h3>
          <p className="max-w-sm text-sm text-stone-500">{t('templates.empty.body')}</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('templates.columns.name')}</th>
                <th>{t('templates.columns.route')}</th>
                <th>{t('templates.columns.departs')}</th>
                <th>{t('templates.columns.duration')}</th>
                <th>{t('trips.fields.branch')}</th>
                <th className="w-0">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => (
                <tr key={template.id}>
                  <td className="font-medium text-stone-900">
                    <bdi>{template.name}</bdi>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      {city(template.originCityId)}
                      <ArrowRight size={14} className="text-stone-400 rtl:-scale-x-100" />
                      {city(template.destinationCityId)}
                    </span>
                  </td>
                  <td className="tabular-nums" dir="ltr">
                    {template.departureTime}
                  </td>
                  <td className="tabular-nums">
                    {t('templates.hours', {
                      hours: format.number(Math.round((template.durationMinutes / 60) * 10) / 10)
                    })}
                  </td>
                  <td>
                    <bdi>{branches.find((b) => b.id === template.branchId)?.name ?? '—'}</bdi>
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        className="icon-btn"
                        title={t('templates.edit')}
                        aria-label={t('templates.editName', { name: template.name })}
                        onClick={() => setEditing(template)}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn hover:text-red-700"
                        title={t('templates.delete')}
                        aria-label={t('templates.deleteName', { name: template.name })}
                        onClick={() => remove(template)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && lists && (
        <TemplateDialog
          template={editing === 'new' ? null : editing}
          lists={{ ...lists, branches }}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setVersion((v) => v + 1)
          }}
        />
      )}
    </section>
  )
}

export default TemplatesPanel
