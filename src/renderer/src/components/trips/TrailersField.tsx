import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { MAX_TRAILERS } from '../../../../shared/fleet'
import type { PlateValue } from '../../lib/plateValue'
import { useFormat } from '../../lib/format'
import PlateInput from '../fleet/PlateInput'

const EMPTY_PLATE: PlateValue = { code: '', series: '', number: '' }

// Plates of the trailers the vehicle pulls on this trip, in order (none for a single vehicle)
function TrailersField({
  value,
  onChange
}: {
  value: PlateValue[]
  onChange: (value: PlateValue[]) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()

  return (
    <div className="flex flex-col gap-3">
      {value.map((plate, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_2.25rem] items-start gap-2">
          <PlateInput
            label={t('trips.trailers.plateOf', { n: format.number(index + 1) })}
            value={plate}
            onChange={(next) => onChange(value.map((p, i) => (i === index ? next : p)))}
          />
          <button
            type="button"
            className="icon-btn mt-7"
            aria-label={t('trips.trailers.removeOf', { n: format.number(index + 1) })}
            title={t('trips.trailers.remove')}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={value.length >= MAX_TRAILERS}
          onClick={() => onChange([...value, { ...EMPTY_PLATE }])}
        >
          <Plus size={16} />
          {t('trips.trailers.add')}
        </button>
        {value.length === 0 && (
          <span className="text-xs text-stone-500">{t('trips.trailers.none')}</span>
        )}
      </div>
    </div>
  )
}

export default TrailersField
