import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, Pencil, Plus, Store } from 'lucide-react'
import type { TripReferenceData } from '@masarat/shared/fleet'
import {
  MAX_BRANCH_NAME_LENGTH,
  type BranchRecord,
  type MemberErrorCode
} from '@masarat/shared/members'
import { FormAlert, SelectField, TextField } from '@masarat/ui/components/form/fields'
import Modal from '@masarat/ui/components/ui/Modal'
import { useFormat } from '@masarat/ui/lib/format'
import { useMountedRef } from '@masarat/ui/lib/useMountedRef'
import { api } from '@masarat/api-client'

// Adds a branch, or renames, moves, closes or reopens one
function BranchDialog({
  branch,
  cities,
  onClose,
  onSaved
}: {
  branch: BranchRecord | null
  cities: TripReferenceData['cities']
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const titleId = useId()
  const activeId = useId()
  const mounted = useMountedRef()
  const [name, setName] = useState(branch?.name ?? '')
  const [cityId, setCityId] = useState(branch ? String(branch.cityId) : '')
  const [active, setActive] = useState(branch?.active ?? true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<MemberErrorCode | null>(null)
  const cityOptions = useMemo(
    () =>
      cities
        .map((c) => ({ value: String(c.id), label: format.city(c) }))
        .sort((a, b) => a.label.localeCompare(b.label, format.isArabic ? 'ar' : 'en')),
    [cities, format]
  )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!name.trim() || !cityId) return setError('missing_fields')
    setPending(true)
    setError(null)
    try {
      const input = { name, cityId: Number(cityId), active }
      const result = branch
        ? await api.company.updateBranch(branch.id, input)
        : await api.company.addBranch(input)
      if (result.ok) return onSaved()
      if (mounted.current) setError(result.error)
    } catch {
      if (mounted.current) setError('unknown')
    }
    if (mounted.current) setPending(false)
  }

  return (
    <Modal labelledBy={titleId} onClose={() => !pending && onClose()}>
      <h2 id={titleId} className="mb-4 text-lg font-semibold">
        {t(branch ? 'branches.form.editTitle' : 'branches.form.title')}
      </h2>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {error && <FormAlert message={t(`members.errors.${error}`)} />}
        <TextField
          label={t('branches.form.name')}
          hint={t('branches.form.nameHint')}
          maxLength={MAX_BRANCH_NAME_LENGTH}
          dir="auto"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <SelectField
          label={t('branches.form.city')}
          placeholder={t('trips.fields.cityPlaceholder')}
          value={cityId}
          options={cityOptions}
          onChange={(e) => setCityId(e.target.value)}
        />
        {branch && (
          <label htmlFor={activeId} className="flex items-center gap-2 text-sm text-stone-700">
            <input
              id={activeId}
              type="checkbox"
              className="size-4 accent-brand-700"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            {t('branches.form.active')}
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending && <LoaderCircle size={16} className="animate-spin" />}
            {t('branches.form.save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// Where the company books trips: often a booth at a land port. Clerks are assigned to one.
function BranchesPanel({
  cities,
  onChanged
}: {
  cities: TripReferenceData['cities']
  // The branches changed (the Team and trip screens list them)
  onChanged: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const mounted = useMountedRef()
  const [branches, setBranches] = useState<BranchRecord[] | null>(null)
  const [error, setError] = useState<MemberErrorCode | null>(null)
  const [editing, setEditing] = useState<BranchRecord | 'new' | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    api.company
      .branches()
      .then((result) => {
        if (!mounted.current) return
        if (!result.ok) return setError(result.error)
        setBranches(result.data)
      })
      .catch(() => mounted.current && setError('unknown'))
  }, [mounted, version])

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">{t('branches.title')}</h2>
          <p className="text-sm text-stone-500">{t('branches.subtitle')}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          <Plus size={16} />
          {t('branches.add')}
        </button>
      </div>

      {error && <FormAlert message={t(`members.errors.${error}`)} />}

      {branches === null ? (
        !error && (
          <div className="flex justify-center py-16 text-stone-400">
            <LoaderCircle className="animate-spin" />
          </div>
        )
      ) : branches.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <Store size={24} />
          </div>
          <h3 className="font-semibold text-stone-900">{t('branches.empty.title')}</h3>
          <p className="max-w-sm text-sm text-stone-500">{t('branches.empty.body')}</p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('branches.columns.name')}</th>
                <th>{t('branches.columns.city')}</th>
                <th>{t('branches.columns.members')}</th>
                <th>{t('branches.columns.trips')}</th>
                <th>{t('branches.columns.status')}</th>
                <th className="w-0">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {branches.map((branch) => (
                <tr key={branch.id} className={branch.active ? undefined : 'text-stone-400'}>
                  <td className="font-medium text-stone-900">
                    <bdi>{branch.name}</bdi>
                  </td>
                  <td>{format.city(cities.find((c) => c.id === branch.cityId))}</td>
                  <td className="tabular-nums">{format.number(branch.memberCount)}</td>
                  <td className="tabular-nums">{format.number(branch.tripCount)}</td>
                  <td>
                    {t(branch.active ? 'branches.statuses.open' : 'branches.statuses.closed')}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      title={t('branches.edit')}
                      aria-label={t('branches.editName', { name: branch.name })}
                      onClick={() => setEditing(branch)}
                    >
                      <Pencil size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <BranchDialog
          branch={editing === 'new' ? null : editing}
          cities={cities}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setVersion((v) => v + 1)
            onChanged()
          }}
        />
      )}
    </section>
  )
}

export default BranchesPanel
