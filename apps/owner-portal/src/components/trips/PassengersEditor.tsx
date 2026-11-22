import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import {
  ID_TYPES,
  MAX_PASSENGERS,
  MAX_PASSENGER_NAME_LENGTH,
  MAX_PASSENGER_NOTES_LENGTH,
  type IdType
} from '@masarat/shared/passengers'
import { useFormat } from '@masarat/ui/lib/format'
import { NumberField } from '@masarat/ui/components/form/fields'
import {
  newPassengerDraft,
  orphanInfants,
  seatConflicts,
  type PassengerDraft
} from './passengerDrafts'

function Labeled({
  htmlFor,
  text,
  children
}: {
  htmlFor: string
  text: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-stone-500">
        {text}
      </label>
      {children}
    </div>
  )
}

const ROW = 'grid grid-cols-[minmax(0,1fr)_8.5rem_9.5rem_4.5rem_2.25rem] items-start gap-2'

// A bus's passengers: name, ID (national ID or passport), seat, and notes. An infant on a
// passenger's lap shares their seat and has no ticket; their ID may be left empty.
function PassengersEditor({
  passengers,
  seats,
  onChange
}: {
  passengers: PassengerDraft[]
  // The bus's seats
  seats: number
  onChange: (passengers: PassengerDraft[]) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const baseId = useId()
  const idOf = (key: number, field: string): string => `${baseId}-${key}-${field}`
  const update = (key: number, patch: Partial<PassengerDraft>): void =>
    onChange(passengers.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  const conflicts = seatConflicts(passengers)
  const orphans = orphanInfants(passengers)
  const seated = passengers.filter((p) => !p.isInfant)
  const infants = passengers.length - seated.length
  // The next seat nobody has
  const taken = new Set(seated.map((p) => Number(p.seatNo)))
  const freeSeat = Array.from({ length: seats }, (_, i) => i + 1).find((n) => !taken.has(n))

  return (
    <div className="flex flex-col gap-3">
      {passengers.length === 0 ? (
        <p className="text-sm text-stone-500">{t('trips.passengers.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {passengers.map((p, index) => {
            const n = format.number(index + 1)
            const id = (field: string): string => idOf(p.key, field)
            const seatInvalid =
              conflicts.has(p.seatNo) ||
              orphans.has(p.key) ||
              (p.seatNo !== '' && (Number(p.seatNo) < 1 || Number(p.seatNo) > seats))
            return (
              <li
                key={p.key}
                className={`flex flex-col gap-2 rounded-lg border p-3 ${p.isInfant ? 'border-dashed border-stone-300 bg-white' : 'border-stone-200 bg-stone-50/60'}`}
              >
                <div className={ROW}>
                  <Labeled htmlFor={id('name')} text={t('trips.passengers.name')}>
                    <input
                      id={id('name')}
                      className="input"
                      aria-label={t('trips.passengers.nameOf', { n })}
                      maxLength={MAX_PASSENGER_NAME_LENGTH}
                      dir="auto"
                      value={p.fullName}
                      onChange={(e) => update(p.key, { fullName: e.target.value })}
                    />
                  </Labeled>
                  <Labeled htmlFor={id('idType')} text={t('trips.passengers.idType')}>
                    <select
                      id={id('idType')}
                      className="input"
                      value={p.idType}
                      onChange={(e) => update(p.key, { idType: e.target.value as IdType })}
                    >
                      {ID_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {t(`idTypes.${type}`)}
                        </option>
                      ))}
                    </select>
                  </Labeled>
                  <Labeled htmlFor={id('idNumber')} text={t('trips.passengers.idNumber')}>
                    <input
                      id={id('idNumber')}
                      className="input font-mono"
                      dir="ltr"
                      placeholder={p.isInfant ? t('trips.passengers.optional') : undefined}
                      maxLength={24}
                      value={p.idNumber}
                      onChange={(e) => update(p.key, { idNumber: e.target.value })}
                    />
                  </Labeled>
                  <Labeled htmlFor={id('seat')} text={t('trips.passengers.seat')}>
                    <NumberField
                      id={id('seat')}
                      ariaLabel={t('trips.passengers.seatOf', { n })}
                      value={p.seatNo}
                      maxDigits={3}
                      invalid={seatInvalid}
                      onValueChange={(seatNo) => update(p.key, { seatNo })}
                    />
                  </Labeled>
                  <button
                    type="button"
                    className="icon-btn mt-5 hover:text-red-700"
                    title={t('trips.passengers.remove')}
                    aria-label={t('trips.passengers.removeOf', { n })}
                    onClick={() => onChange(passengers.filter((x) => x.key !== p.key))}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      className="size-4 accent-brand-700"
                      checked={p.isInfant}
                      onChange={(e) =>
                        update(p.key, {
                          isInfant: e.target.checked,
                          // An infant is written down as such on the manifest
                          notes:
                            e.target.checked && !p.notes
                              ? t('trips.passengers.infantNote')
                              : p.notes
                        })
                      }
                    />
                    {t('trips.passengers.infant')}
                  </label>
                  <input
                    className="input"
                    aria-label={t('trips.passengers.notesOf', { n })}
                    placeholder={t('trips.passengers.notesPlaceholder')}
                    maxLength={MAX_PASSENGER_NOTES_LENGTH}
                    dir="auto"
                    value={p.notes}
                    onChange={(e) => update(p.key, { notes: e.target.value })}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={passengers.length >= MAX_PASSENGERS}
          onClick={() =>
            onChange([
              ...passengers,
              newPassengerDraft(undefined, freeSeat ? String(freeSeat) : '')
            ])
          }
        >
          <Plus size={16} />
          {t('trips.passengers.add')}
        </button>
        <span
          className={`text-sm tabular-nums ${seated.length > seats ? 'font-medium text-red-700' : 'text-stone-600'}`}
        >
          {t('trips.passengers.total', {
            seated: format.number(seated.length),
            seats: format.number(seats),
            infants: format.number(infants)
          })}
        </span>
      </div>
      {conflicts.size > 0 && (
        <p className="field-hint text-red-700">{t('fleet.errors.seat_taken')}</p>
      )}
      {orphans.size > 0 && (
        <p className="field-hint text-red-700">{t('trips.passengers.infantSeat')}</p>
      )}
    </div>
  )
}

export default PassengersEditor
