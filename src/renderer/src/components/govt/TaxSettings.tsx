import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Info, LoaderCircle } from 'lucide-react'
import type { FleetErrorCode } from '../../../../shared/fleet'
import {
  MAX_TAX_BPS,
  TAX_CODES,
  calculateTaxes,
  type TaxCode,
  type TaxRatesInput,
  type TaxSettingsView
} from '../../../../shared/tax'
import { useFormat } from '../../lib/format'
import { useMountedRef } from '../../lib/useMountedRef'
import { FormAlert, NumberField, SubmitButton } from '../form/fields'
import { Card } from './parts'

type Drafts = Record<TaxCode, string>

// Trip cost used for the "what the owner pays" example
const EXAMPLE_TRIP_COST = 1_000_000

// Basis points <-> the percentage typed in the form ("17", "12.5")
const toPercentText = (bps: number): string => String(bps / 100)
const toBps = (text: string): number | null => {
  if (text === '') return null
  const bps = Math.round(Number(text) * 100)
  return Number.isFinite(bps) && bps >= 0 && bps <= MAX_TAX_BPS ? bps : null
}

const draftsFrom = (view: TaxSettingsView): Drafts =>
  Object.fromEntries(
    TAX_CODES.map((code) => [
      code,
      toPercentText(view.rates.find((r) => r.code === code)?.rateBps ?? 0)
    ])
  ) as Drafts

// Government users set the tax percentages; every change is logged with who made it
function TaxSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const mounted = useMountedRef()
  const [view, setView] = useState<TaxSettingsView | null>(null)
  const [drafts, setDrafts] = useState<Drafts | null>(null)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    window.api.govt
      .getTaxSettings()
      .then((result) => {
        if (!mounted.current) return
        if (!result.ok) return setError(result.error)
        setView(result.data)
        setDrafts(draftsFrom(result.data))
      })
      .catch(() => mounted.current && setError('unknown'))
  }, [mounted])

  if (!view || !drafts) {
    return error ? (
      <FormAlert message={t(`fleet.errors.${error}`)} />
    ) : (
      <div className="flex justify-center py-16 text-stone-400">
        <LoaderCircle className="animate-spin" />
      </div>
    )
  }

  const bps = Object.fromEntries(TAX_CODES.map((code) => [code, toBps(drafts[code])])) as Record<
    TaxCode,
    number | null
  >
  const invalid = TAX_CODES.filter((code) => bps[code] === null)
  const current = (code: TaxCode): number => view.rates.find((r) => r.code === code)?.rateBps ?? 0
  const changed = TAX_CODES.filter((code) => bps[code] !== null && bps[code] !== current(code))
  const example = calculateTaxes(
    EXAMPLE_TRIP_COST,
    TAX_CODES.map((code) => ({ code, rateBps: bps[code] ?? 0 }))
  )

  const edit = (code: TaxCode, value: string): void => {
    setSaved(false)
    setError(null)
    setDrafts({ ...drafts, [code]: value })
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (invalid.length > 0) return setError('invalid_tax_rate')
    if (changed.length === 0) return
    const input: TaxRatesInput = Object.fromEntries(changed.map((code) => [code, bps[code]]))
    setPending(true)
    setError(null)
    try {
      const result = await window.api.govt.updateTaxRates(input)
      if (!mounted.current) return
      if (!result.ok) return setError(result.error)
      setView(result.data)
      setDrafts(draftsFrom(result.data))
      setSaved(true)
    } catch {
      if (mounted.current) setError('unknown')
    } finally {
      if (mounted.current) setPending(false)
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-stone-900">{t('govt.taxes.title')}</h2>
        <p className="text-sm text-stone-500">{t('govt.taxes.subtitle')}</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <form className="card flex flex-col gap-5 p-6" onSubmit={handleSubmit} noValidate>
          {error && <FormAlert message={t(`fleet.errors.${error}`)} />}
          {saved && <FormAlert tone="success" message={t('govt.taxes.saved')} />}

          {TAX_CODES.map((code) => (
            <NumberField
              key={code}
              label={t(`taxes.${code}`)}
              value={drafts[code]}
              allowDecimal
              maxDigits={5}
              suffix="%"
              invalid={bps[code] === null}
              hint={
                bps[code] === null
                  ? t('fleet.errors.invalid_tax_rate')
                  : bps[code] !== current(code)
                    ? t('govt.taxes.was', { rate: format.taxRate(current(code)) })
                    : undefined
              }
              onValueChange={(value) => edit(code, value)}
            />
          ))}

          <div className="rounded-lg border border-brand-200 bg-brand-50 p-4 text-sm text-brand-900">
            <div className="flex items-baseline justify-between gap-4 font-medium">
              <span>{t('govt.taxes.totalRate')}</span>
              <span className="tabular-nums">
                {format.taxRate(TAX_CODES.reduce((sum, code) => sum + (bps[code] ?? 0), 0))}
              </span>
            </div>
            <p className="mt-1 text-xs text-brand-800">
              {t('govt.taxes.example', {
                cost: format.currency(EXAMPLE_TRIP_COST),
                amount: format.currency(example.total)
              })}
            </p>
          </div>

          <p className="flex gap-2 text-xs text-stone-500">
            <Info size={14} className="mt-0.5 shrink-0" />
            {t('govt.taxes.appliesTo')}
          </p>

          <div className="flex justify-end gap-2 border-t border-stone-200 pt-5">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pending || changed.length + invalid.length === 0}
              onClick={() => {
                setDrafts(draftsFrom(view))
                setError(null)
              }}
            >
              {t('govt.taxes.reset')}
            </button>
            <SubmitButton pending={pending} className="" label={t('govt.taxes.save')} />
          </div>
        </form>

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
                      <td>{t(`taxes.${change.code}`)}</td>
                      <td className="whitespace-nowrap tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          {format.taxRate(change.oldBps)}
                          <ArrowRight size={14} className="text-stone-400 rtl:-scale-x-100" />
                          <span className="font-medium text-stone-900">
                            {format.taxRate(change.newBps)}
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </section>
  )
}

export default TaxSettings
