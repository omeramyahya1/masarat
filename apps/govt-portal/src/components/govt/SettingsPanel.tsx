import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { errorCode, queryClient, queryKeys, unwrap } from '@masarat/ui/lib/query'
import { Info, LoaderCircle } from 'lucide-react'
import type { FleetErrorCode } from '@masarat/shared/fleet'
import {
  MAX_SPEED_KMH,
  MAX_VALIDITY_MARGIN_HOURS,
  MIN_SPEED_KMH,
  type SystemSettings
} from '@masarat/shared/settings'
import { TRIP_CATEGORIES, type TripCategory } from '@masarat/shared/tax'
import { FormAlert, NumberField, SubmitButton } from '@masarat/ui/components/form/fields'
import { useMountedRef } from '@masarat/ui/lib/useMountedRef'
import { api } from '@masarat/api-client'

type Drafts = Record<'margin' | 'speed', Record<TripCategory, string>>

const draftsFrom = (s: SystemSettings): Drafts => ({
  margin: {
    cargo: String(s.validityMarginHours.cargo),
    passenger: String(s.validityMarginHours.passenger)
  },
  speed: { cargo: String(s.averageSpeedKmh.cargo), passenger: String(s.averageSpeedKmh.passenger) }
})

const inRange = (text: string, min: number, max: number): number | null => {
  const n = Number(text)
  return text !== '' && Number.isInteger(n) && n >= min && n <= max ? n : null
}

// Government admins set how long documents stay valid after a trip's estimated arrival, and the
// average speeds the trip form suggests the arrival from, per kind of trip
function SettingsPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const mounted = useMountedRef()
  // Cached (lib/query.ts); the form starts from it and edits a draft of its own
  const settingsQuery = useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => unwrap(api.govt.settings())
  })
  const [drafts, setDrafts] = useState<Drafts | null>(() =>
    settingsQuery.data ? draftsFrom(settingsQuery.data) : null
  )
  if (!drafts && settingsQuery.data) setDrafts(draftsFrom(settingsQuery.data))
  const [actionError, setError] = useState<FleetErrorCode | null>(null)
  const error = actionError ?? errorCode<FleetErrorCode>(settingsQuery.error)
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)

  if (!drafts) {
    return error ? (
      <FormAlert message={t(`fleet.errors.${error}`)} />
    ) : (
      <div className="flex justify-center py-16 text-stone-400">
        <LoaderCircle className="animate-spin" />
      </div>
    )
  }

  const margin = (c: TripCategory): number | null =>
    inRange(drafts.margin[c], 0, MAX_VALIDITY_MARGIN_HOURS)
  const speed = (c: TripCategory): number | null =>
    inRange(drafts.speed[c], MIN_SPEED_KMH, MAX_SPEED_KMH)
  const edit = (field: keyof Drafts, c: TripCategory, value: string): void => {
    setSaved(false)
    setDrafts({ ...drafts, [field]: { ...drafts[field], [c]: value } })
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (TRIP_CATEGORIES.some((c) => margin(c) === null || speed(c) === null)) {
      return setError('invalid_settings')
    }
    const input = {
      validityMarginHours: { cargo: margin('cargo')!, passenger: margin('passenger')! },
      averageSpeedKmh: { cargo: speed('cargo')!, passenger: speed('passenger')! }
    }
    setPending(true)
    setError(null)
    try {
      const result = await api.govt.updateSettings(input)
      if (!mounted.current) return
      if (!result.ok) return setError(result.error)
      queryClient.setQueryData(queryKeys.settings, result.data)
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
        <h2 className="text-lg font-semibold text-stone-900">{t('govt.settings.title')}</h2>
        <p className="max-w-2xl text-sm text-stone-500">{t('govt.settings.subtitle')}</p>
      </div>
      <form className="card flex max-w-2xl flex-col gap-5 p-6" onSubmit={handleSubmit} noValidate>
        {error && <FormAlert message={t(`fleet.errors.${error}`)} />}
        {saved && <FormAlert tone="success" message={t('govt.settings.saved')} />}
        {TRIP_CATEGORIES.map((c) => (
          <fieldset key={c} className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-stone-800">
              {t(`govt.taxes.appliesOn.${c}`)}
            </legend>
            <NumberField
              label={t('govt.settings.margin')}
              hint={t('govt.settings.marginHint')}
              value={drafts.margin[c]}
              maxDigits={3}
              suffix={t('govt.settings.hours')}
              invalid={margin(c) === null}
              onValueChange={(value) => edit('margin', c, value)}
            />
            <NumberField
              label={t('govt.settings.speed')}
              hint={t('govt.settings.speedHint')}
              value={drafts.speed[c]}
              maxDigits={3}
              suffix={t('govt.settings.kmh')}
              invalid={speed(c) === null}
              onValueChange={(value) => edit('speed', c, value)}
            />
          </fieldset>
        ))}
        <p className="flex gap-2 text-xs text-stone-500">
          <Info size={14} className="mt-0.5 shrink-0" />
          {t('govt.settings.appliesTo')}
        </p>
        <div className="flex justify-end border-t border-stone-200 pt-5">
          <SubmitButton pending={pending} className="" label={t('govt.taxes.save')} />
        </div>
      </form>
    </section>
  )
}

export default SettingsPanel
