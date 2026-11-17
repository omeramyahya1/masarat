import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import {
  MAX_CARGO_ITEMS,
  MAX_ITEM_NAME_LENGTH,
  itemUnitsFor,
  type ItemUnit,
  type QuantityUnit
} from '../../../../shared/fleet'
import { useFormat } from '../../lib/format'
import { NumberField } from '../form/fields'
import { newItemDraft, type ItemDraft } from './itemDrafts'

interface CargoItemsEditorProps {
  items: ItemDraft[]
  // The vehicle's capacity unit; item units are limited to the ones that convert to it
  unit: QuantityUnit
  // Total of the items in the vehicle's unit
  total: number
  capacity: number
  onChange: (items: ItemDraft[]) => void
}

// The list of goods loaded on the vehicle: name, quantity and unit per row
function CargoItemsEditor({
  items,
  unit,
  total,
  capacity,
  onChange
}: CargoItemsEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const units = itemUnitsFor(unit)
  const overCapacity = total > capacity
  const update = (key: number, patch: Partial<ItemDraft>): void =>
    onChange(items.map((item) => (item.key === key ? { ...item, ...patch } : item)))

  return (
    <div className="flex flex-col gap-3">
      <div className="hidden grid-cols-[minmax(0,1fr)_8rem_6.5rem_2.25rem] gap-2 text-xs font-medium text-stone-500 sm:grid">
        <span>{t('trips.items.name')}</span>
        <span>{t('trips.items.quantity')}</span>
        <span>{t('trips.items.unit')}</span>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => {
          const n = format.number(index + 1)
          return (
            <li
              key={item.key}
              className="grid grid-cols-[minmax(0,1fr)_8rem_6.5rem_2.25rem] items-start gap-2"
            >
              <input
                className="input"
                aria-label={t('trips.items.nameOf', { n })}
                placeholder={t(`trips.items.namePlaceholder.${unit}`)}
                maxLength={MAX_ITEM_NAME_LENGTH}
                value={item.name}
                onChange={(e) => update(item.key, { name: e.target.value })}
              />
              <NumberField
                ariaLabel={t('trips.items.quantityOf', { n })}
                value={item.quantity}
                allowDecimal
                maxDigits={9}
                onValueChange={(quantity) => update(item.key, { quantity })}
              />
              <select
                className="input"
                aria-label={t('trips.items.unitOf', { n })}
                value={item.unit}
                onChange={(e) => update(item.key, { unit: e.target.value as ItemUnit })}
              >
                {units.map((u) => (
                  <option key={u} value={u}>
                    {t(`units.name.${u}`)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn mt-0.5"
                aria-label={t('trips.items.removeOf', { n })}
                title={t('trips.items.remove')}
                disabled={items.length === 1}
                onClick={() => onChange(items.filter((i) => i.key !== item.key))}
              >
                <Trash2 size={16} />
              </button>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={items.length >= MAX_CARGO_ITEMS}
          onClick={() => onChange([...items, newItemDraft(unit)])}
        >
          <Plus size={16} />
          {t('trips.items.add')}
        </button>
        <span
          className={`text-sm tabular-nums ${overCapacity ? 'font-medium text-red-700' : 'text-stone-600'}`}
        >
          {t('trips.items.total', {
            total: format.quantity(total, unit),
            capacity: format.quantity(capacity, unit)
          })}
        </span>
      </div>
      {overCapacity && <p className="field-hint text-red-700">{t('fleet.errors.over_capacity')}</p>}
    </div>
  )
}

export default CargoItemsEditor
