import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PLATE_CODES,
  PLATE_LETTERS_AR,
  PLATE_NUMBER_MAX_DIGITS,
  PLATE_SERIES_MAX_DIGITS,
  type PlateCode
} from '@masarat/shared/plate'
import { plateValueToString, type PlateValue } from '@masarat/ui/lib/plateValue'
import { FieldLabel, NumberField } from '@masarat/ui/components/form/fields'
import PlateBadge from '@masarat/ui/components/fleet/PlateBadge'

interface PlateInputProps {
  value: PlateValue
  onChange: (value: PlateValue) => void
  // Defaults to "Plate number"
  label?: string
}

// State letters + series / number. The letters show in Arabic (with the state name) while the UI is Arabic;
// the value is always the English code.
function PlateInput({ value, onChange, label }: PlateInputProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isArabic = i18n.language === 'ar'
  const codeId = useId()
  const plate = plateValueToString(value)

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={codeId} label={label ?? t('fleet.fields.plate')} />
      <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,0.6fr)_auto_minmax(0,1fr)] items-center gap-2">
        <select
          id={codeId}
          className="input"
          aria-label={t('fleet.fields.plateState')}
          value={value.code}
          onChange={(e) => onChange({ ...value, code: e.target.value as PlateCode })}
        >
          <option value="" disabled>
            {t('fleet.fields.plateStatePlaceholder')}
          </option>
          {PLATE_CODES.map((code) => (
            <option key={code} value={code}>
              {isArabic ? PLATE_LETTERS_AR[code] : code} — {t(`plates.states.${code}`)}
            </option>
          ))}
        </select>
        <NumberField
          ariaLabel={t('fleet.fields.plateSeries')}
          value={value.series}
          maxDigits={PLATE_SERIES_MAX_DIGITS}
          arabicDigits
          placeholder={t('fleet.fields.plateSeriesPlaceholder')}
          onValueChange={(series) => onChange({ ...value, series })}
        />
        <span className="text-lg text-stone-400" aria-hidden>
          /
        </span>
        <NumberField
          ariaLabel={t('fleet.fields.plateNumber')}
          value={value.number}
          maxDigits={PLATE_NUMBER_MAX_DIGITS}
          arabicDigits
          placeholder={t('fleet.fields.plateNumberPlaceholder')}
          onValueChange={(number) => onChange({ ...value, number })}
        />
      </div>
      <div className="flex min-h-8 items-center gap-2">
        {plate ? (
          <>
            <span className="field-hint">{t('fleet.fields.platePreview')}</span>
            <PlateBadge plate={plate} />
          </>
        ) : (
          <span className="field-hint">{t('fleet.fields.plateHint')}</span>
        )}
      </div>
    </div>
  )
}

export default PlateInput
