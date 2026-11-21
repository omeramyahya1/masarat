import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import {
  MAX_CARGO_ITEMS,
  MAX_ITEM_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  MAX_PACKING_LENGTH,
  PACKING_SUGGESTIONS,
  itemUnitsFor,
  type CargoType,
  type ItemUnit,
  type QuantityUnit
} from '@masarat/shared/fleet'
import { useFormat } from '@masarat/ui/lib/format'
import { NumberField } from '@masarat/ui/components/form/fields'
import { newItemDraft, type ItemDraft } from './itemDrafts'

interface CargoItemsEditorProps {
  items: ItemDraft[]
  // The vehicle's capacity unit; item units are limited to the ones that convert to it
  unit: QuantityUnit
  // Cargo types the vehicle can carry (their rate's unit matches the vehicle's)
  cargoTypes: readonly CargoType[]
  // Total of the items in the vehicle's unit
  total: number
  capacity: number
  // Packing types the owner used before, suggested next to the common ones
  usedPackingTypes: readonly string[]
  // Rows filled in from a scanned document and not edited since
  highlighted?: ReadonlySet<number>
  onChange: (items: ItemDraft[]) => void
}

// A small label directly above one of an item's inputs
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

const ROW = 'grid grid-cols-[9.5rem_minmax(0,1fr)_7rem_6.5rem_2.25rem] items-start gap-2'
const DETAILS_ROW = 'grid grid-cols-[9.5rem_7rem_minmax(0,1fr)_2.25rem] items-start gap-2'

// The packing list loaded on the vehicle. Each item has its cargo type, description, weight and
// unit, then its packing type, number of packages and notes.
function CargoItemsEditor({
  items,
  unit,
  cargoTypes,
  total,
  capacity,
  usedPackingTypes,
  highlighted,
  onChange
}: CargoItemsEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const packingListId = useId()
  // Each input's id: <base>-<item key>-<field>, so every label points at its own input
  const baseId = useId()
  const idOf = (key: number, field: string): string => `${baseId}-${key}-${field}`
  const packingOptions = [
    ...new Set([...PACKING_SUGGESTIONS.map((p) => t(`packingTypes.${p}`)), ...usedPackingTypes])
  ]
  const units = itemUnitsFor(unit)
  const overCapacity = total > capacity
  const update = (key: number, patch: Partial<ItemDraft>): void =>
    onChange(items.map((item) => (item.key === key ? { ...item, ...patch } : item)))

  return (
    <div className="flex flex-col gap-3">
      <datalist id={packingListId}>
        {packingOptions.map((option) => (
          <option key={option} value={option} />
        ))}
      </datalist>
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => {
          const n = format.number(index + 1)
          const id = (field: string): string => idOf(item.key, field)
          return (
            <li
              key={item.key}
              className={`flex flex-col gap-2 rounded-lg border p-3 ${
                highlighted?.has(item.key)
                  ? 'border-amber-300 bg-amber-50/70 ring-1 ring-amber-300'
                  : 'border-stone-200 bg-stone-50/60'
              }`}
            >
              <div className={ROW}>
                <Labeled htmlFor={id('type')} text={t('trips.items.type')}>
                  <select
                    id={id('type')}
                    className="input"
                    aria-label={t('trips.items.typeOf', { n })}
                    value={item.cargoType}
                    onChange={(e) => update(item.key, { cargoType: e.target.value as CargoType })}
                  >
                    <option value="" disabled>
                      {t('trips.fields.cargoTypePlaceholder')}
                    </option>
                    {cargoTypes.map((type) => (
                      <option key={type} value={type}>
                        {t(`cargoTypes.${type}`)}
                      </option>
                    ))}
                  </select>
                </Labeled>
                <Labeled htmlFor={id('name')} text={t('trips.items.name')}>
                  <input
                    id={id('name')}
                    className="input"
                    aria-label={t('trips.items.nameOf', { n })}
                    placeholder={t(`trips.items.namePlaceholder.${unit}`)}
                    maxLength={MAX_ITEM_NAME_LENGTH}
                    value={item.name}
                    onChange={(e) => update(item.key, { name: e.target.value })}
                  />
                </Labeled>
                <Labeled htmlFor={id('quantity')} text={t('trips.items.quantity')}>
                  <NumberField
                    id={id('quantity')}
                    ariaLabel={t('trips.items.quantityOf', { n })}
                    value={item.quantity}
                    allowDecimal
                    maxDigits={9}
                    onValueChange={(quantity) => update(item.key, { quantity })}
                  />
                </Labeled>
                <Labeled htmlFor={id('unit')} text={t('trips.items.unit')}>
                  <select
                    id={id('unit')}
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
                </Labeled>
                <button
                  type="button"
                  // Level with the inputs, below their labels
                  className="icon-btn mt-6"
                  aria-label={t('trips.items.removeOf', { n })}
                  title={t('trips.items.remove')}
                  disabled={items.length === 1}
                  onClick={() => onChange(items.filter((i) => i.key !== item.key))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              <div className={DETAILS_ROW}>
                <Labeled htmlFor={id('packing')} text={t('trips.items.packingType')}>
                  <input
                    id={id('packing')}
                    className="input"
                    list={packingListId}
                    aria-label={t('trips.items.packingTypeOf', { n })}
                    placeholder={t('trips.items.packingTypePlaceholder')}
                    maxLength={MAX_PACKING_LENGTH}
                    value={item.packingType}
                    onChange={(e) => update(item.key, { packingType: e.target.value })}
                  />
                </Labeled>
                <Labeled htmlFor={id('packages')} text={t('trips.items.packageCount')}>
                  <NumberField
                    id={id('packages')}
                    ariaLabel={t('trips.items.packageCountOf', { n })}
                    placeholder={t('trips.items.packageCountPlaceholder')}
                    value={item.packageCount}
                    maxDigits={7}
                    onValueChange={(packageCount) => update(item.key, { packageCount })}
                  />
                </Labeled>
                <Labeled htmlFor={id('notes')} text={t('trips.items.notes')}>
                  <input
                    id={id('notes')}
                    className="input"
                    aria-label={t('trips.items.notesOf', { n })}
                    placeholder={t('trips.items.notesPlaceholder')}
                    maxLength={MAX_NOTES_LENGTH}
                    value={item.notes}
                    onChange={(e) => update(item.key, { notes: e.target.value })}
                  />
                </Labeled>
              </div>
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={items.length >= MAX_CARGO_ITEMS}
          // A new row starts with the previous row's cargo type
          onClick={() =>
            onChange([...items, newItemDraft(unit, items[items.length - 1]?.cargoType ?? '')])
          }
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
