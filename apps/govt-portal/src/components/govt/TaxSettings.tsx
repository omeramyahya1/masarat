import { useEffect, useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Info, LoaderCircle, Pencil, Plus } from 'lucide-react'
import type { FleetErrorCode } from '@masarat/shared/fleet'
import {
  CHARGE_KINDS,
  MAX_CHARGE_NAME_LENGTH,
  MAX_FEE,
  MAX_TAX_BPS,
  TRIP_CATEGORIES,
  calculateCharges,
  chargeValueFor,
  type ChargeChange,
  type ChargeInput,
  type ChargeKind,
  type ChargeRecord,
  type ChargesView,
  type TripCategory
} from '@masarat/shared/tax'
import { useFormat } from '@masarat/ui/lib/format'
import { useMountedRef } from '@masarat/ui/lib/useMountedRef'
import { FormAlert, NumberField, TextField } from '@masarat/ui/components/form/fields'
import Modal from '@masarat/ui/components/ui/Modal'
import { Card } from './parts'
import { api } from '@masarat/api-client'

// Trip cost used for the "what a trip pays" example
const EXAMPLE_TRIP_COST = 1_000_000

// A value as typed: a percentage ("17", "12.5") stored as basis points, or whole SDG
const parseValue = (kind: ChargeKind, text: string): number | null => {
  if (text === '') return null
  if (kind === 'percent') {
    const bps = Math.round(Number(text) * 100)
    return Number.isFinite(bps) && bps >= 0 && bps <= MAX_TAX_BPS ? bps : null
  }
  const amount = Number(text)
  return Number.isInteger(amount) && amount >= 0 && amount <= MAX_FEE ? amount : null
}
const valueText = (kind: ChargeKind, value: number | null): string =>
  value === null ? '' : kind === 'percent' ? String(value / 100) : String(value)

interface Draft {
  name: string
  nameAr: string
  kind: ChargeKind
  // Whether it's charged on each kind of trip, and the value typed for it
  applies: Record<TripCategory, boolean>
  values: Record<TripCategory, string>
  active: boolean
}

const draftFrom = (charge: ChargeRecord | null): Draft => ({
  name: charge?.name ?? '',
  nameAr: charge?.nameAr ?? '',
  kind: charge?.kind ?? 'fixed',
  applies: {
    cargo: charge ? charge.cargoValue !== null : true,
    passenger: charge ? charge.passengerValue !== null : true
  },
  values: {
    cargo: charge ? valueText(charge.kind, charge.cargoValue) : '',
    passenger: charge ? valueText(charge.kind, charge.passengerValue) : ''
  },
  active: charge?.active ?? true
})

// Adds a fee or tax, or changes one: its names, its value on each kind of trip (or not charged on
// it), and whether it's on. A charge's kind is fixed once it exists.
function ChargeDialog({
  charge,
  onClose,
  onSaved
}: {
  charge: ChargeRecord | null
  onClose: () => void
  onSaved: (view: ChargesView) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const titleId = useId()
  const baseId = useId()
  const mounted = useMountedRef()
  const [draft, setDraft] = useState<Draft>(() => draftFrom(charge))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const set = (patch: Partial<Draft>): void => setDraft((current) => ({ ...current, ...patch }))

  const parsed = Object.fromEntries(
    TRIP_CATEGORIES.map((c) => [
      c,
      draft.applies[c] ? parseValue(draft.kind, draft.values[c]) : null
    ])
  ) as Record<TripCategory, number | null>
  const invalid = TRIP_CATEGORIES.filter((c) => draft.applies[c] && parsed[c] === null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!draft.name.trim() || !draft.nameAr.trim()) return setError('missing_fields')
    if (invalid.length > 0) {
      return setError(draft.kind === 'percent' ? 'invalid_tax_rate' : 'invalid_fee')
    }
    if (!draft.applies.cargo && !draft.applies.passenger) return setError('invalid_charge')
    const input: ChargeInput = {
      name: draft.name,
      nameAr: draft.nameAr,
      kind: draft.kind,
      cargoValue: parsed.cargo,
      passengerValue: parsed.passenger,
      active: draft.active
    }
    setPending(true)
    setError(null)
    try {
      const result = charge
        ? await api.govt.updateCharge(charge.id, input)
        : await api.govt.addCharge(input)
      if (result.ok) return onSaved(result.data)
      if (mounted.current) setError(result.error)
    } catch {
      if (mounted.current) setError('unknown')
    }
    if (mounted.current) setPending(false)
  }

  return (
    <Modal labelledBy={titleId} className="max-w-lg" onClose={() => !pending && onClose()}>
      <h2 id={titleId} className="mb-4 text-lg font-semibold">
        {t(charge ? 'govt.taxes.form.editTitle' : 'govt.taxes.form.title')}
      </h2>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {error && <FormAlert message={t(`fleet.errors.${error}`)} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('govt.taxes.form.nameAr')}
            maxLength={MAX_CHARGE_NAME_LENGTH}
            dir="rtl"
            autoFocus
            value={draft.nameAr}
            onChange={(e) => set({ nameAr: e.target.value })}
          />
          <TextField
            label={t('govt.taxes.form.name')}
            maxLength={MAX_CHARGE_NAME_LENGTH}
            ltr
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
        {!charge && (
          <fieldset className="flex flex-col gap-2">
            <legend className="label mb-1">{t('govt.taxes.form.kind')}</legend>
            {CHARGE_KINDS.map((kind) => (
              <label key={kind} className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="radio"
                  name={`${baseId}-kind`}
                  className="size-4 accent-brand-700"
                  checked={draft.kind === kind}
                  onChange={() => set({ kind })}
                />
                {t(`govt.taxes.kinds.${kind}`)}
              </label>
            ))}
          </fieldset>
        )}
        {TRIP_CATEGORIES.map((category) => (
          <div
            key={category}
            className="flex flex-col gap-2 rounded-lg border border-stone-200 p-3"
          >
            <label className="flex items-center gap-2 text-sm font-medium text-stone-800">
              <input
                type="checkbox"
                className="size-4 accent-brand-700"
                checked={draft.applies[category]}
                onChange={(e) =>
                  set({ applies: { ...draft.applies, [category]: e.target.checked } })
                }
              />
              {t(`govt.taxes.appliesOn.${category}`)}
            </label>
            {draft.applies[category] && (
              <NumberField
                label={t('govt.taxes.form.value')}
                value={draft.values[category]}
                allowDecimal={draft.kind === 'percent'}
                maxDigits={draft.kind === 'percent' ? 5 : 7}
                suffix={draft.kind === 'percent' ? '%' : t('govt.taxes.feeUnit')}
                invalid={invalid.includes(category)}
                onValueChange={(value) => set({ values: { ...draft.values, [category]: value } })}
              />
            )}
          </div>
        ))}
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            className="size-4 accent-brand-700"
            checked={draft.active}
            onChange={(e) => set({ active: e.target.checked })}
          />
          {t('govt.taxes.form.active')}
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending && <LoaderCircle size={16} className="animate-spin" />}
            {t('govt.taxes.save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// Government admins set the taxes and fees, per kind of trip, and add their own; every change is
// logged with who made it
function TaxSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const mounted = useMountedRef()
  const [view, setView] = useState<ChargesView | null>(null)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [editing, setEditing] = useState<ChargeRecord | 'new' | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.govt
      .charges()
      .then((result) => {
        if (!mounted.current) return
        if (!result.ok) return setError(result.error)
        setView(result.data)
      })
      .catch(() => mounted.current && setError('unknown'))
  }, [mounted])

  if (!view) {
    return error ? (
      <FormAlert message={t(`fleet.errors.${error}`)} />
    ) : (
      <div className="flex justify-center py-16 text-stone-400">
        <LoaderCircle className="animate-spin" />
      </div>
    )
  }

  // A value as stored: a percentage or an amount; "not charged" when it doesn't apply
  const formatValue = (kind: ChargeKind, value: number | null): string =>
    value === null
      ? t('govt.taxes.notCharged')
      : kind === 'percent'
        ? format.taxRate(value)
        : format.currency(value)

  const changeText = (change: ChargeChange, value: string | null): string => {
    switch (change.field) {
      case 'cargoValue':
      case 'passengerValue':
        return formatValue(change.kind, value === null ? null : Number(value))
      case 'active':
        return t(value === 'true' ? 'govt.taxes.on' : 'govt.taxes.off')
      default:
        return value ?? '—'
    }
  }

  const example = (category: TripCategory): number =>
    calculateCharges(EXAMPLE_TRIP_COST, view.charges, category).total

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">{t('govt.taxes.title')}</h2>
          <p className="max-w-2xl text-sm text-stone-500">{t('govt.taxes.subtitle')}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          <Plus size={16} />
          {t('govt.taxes.add')}
        </button>
      </div>

      {saved && <FormAlert tone="success" message={t('govt.taxes.saved')} />}

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('govt.taxes.columns.name')}</th>
              <th>{t('govt.taxes.columns.kind')}</th>
              <th>{t('govt.taxes.appliesOn.cargo')}</th>
              <th>{t('govt.taxes.appliesOn.passenger')}</th>
              <th className="w-0">
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {view.charges.map((charge) => (
              <tr key={charge.id} className={charge.active ? undefined : 'text-stone-400'}>
                <td className="font-medium text-stone-900">
                  <bdi>{format.chargeName(charge)}</bdi>
                  {!charge.builtin && (
                    <span className="ms-2 rounded bg-stone-100 px-1.5 text-[11px] font-medium text-stone-600">
                      {t('govt.taxes.custom')}
                    </span>
                  )}
                  {!charge.active && (
                    <span className="ms-2 rounded bg-amber-50 px-1.5 text-[11px] font-medium text-amber-800">
                      {t('govt.taxes.off')}
                    </span>
                  )}
                </td>
                <td>{t(`govt.taxes.kinds.${charge.kind}`)}</td>
                {TRIP_CATEGORIES.map((category) => (
                  <td key={category} className="whitespace-nowrap tabular-nums">
                    {formatValue(charge.kind, chargeValueFor(charge, category))}
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="icon-btn"
                    title={t('govt.taxes.edit')}
                    aria-label={t('govt.taxes.editName', { name: format.chargeName(charge) })}
                    onClick={() => setEditing(charge)}
                  >
                    <Pencil size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="flex flex-col gap-3 rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900">
          {TRIP_CATEGORIES.map((category) => (
            <p key={category}>
              {t(`govt.taxes.example.${category}`, {
                cost: format.currency(EXAMPLE_TRIP_COST),
                amount: format.currency(example(category))
              })}
            </p>
          ))}
          <p className="flex gap-2 text-xs text-brand-800">
            <Info size={14} className="mt-0.5 shrink-0" />
            {t('govt.taxes.appliesTo')}
          </p>
        </div>

        <Card title={t('govt.taxes.history.title')}>
          {view.history.length === 0 ? (
            <p className="py-8 text-center text-sm text-stone-500">
              {t('govt.taxes.history.empty')}
            </p>
          ) : (
            <div className="-mx-5 overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('govt.taxes.history.date')}</th>
                    <th>{t('govt.taxes.history.user')}</th>
                    <th>{t('govt.taxes.history.tax')}</th>
                    <th>{t('govt.taxes.history.change')}</th>
                  </tr>
                </thead>
                <tbody>
                  {view.history.map((change, index) => (
                    <tr key={index}>
                      <td className="whitespace-nowrap">{format.dateTime(change.changedAt)}</td>
                      <td>
                        <bdi>{change.changedBy}</bdi>
                      </td>
                      <td>
                        <bdi>{format.chargeName(change)}</bdi>
                        <div className="text-xs text-stone-500">
                          {t(`govt.taxes.fields.${change.field}`)}
                        </div>
                      </td>
                      <td className="tabular-nums">
                        {change.field === 'created' ? (
                          t('govt.taxes.added')
                        ) : (
                          <span className="inline-flex flex-wrap items-center gap-1.5">
                            <bdi>{changeText(change, change.oldValue)}</bdi>
                            <ArrowRight size={14} className="text-stone-400 rtl:-scale-x-100" />
                            <bdi className="font-medium text-stone-900">
                              {changeText(change, change.newValue)}
                            </bdi>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {editing && (
        <ChargeDialog
          charge={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setEditing(null)
            setView(next)
            setSaved(true)
          }}
        />
      )}
    </section>
  )
}

export default TaxSettings
