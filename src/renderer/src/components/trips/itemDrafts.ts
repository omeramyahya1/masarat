// Cargo item rows as the trip form edits them
import {
  itemUnitsFor,
  type CargoItem,
  type ItemUnit,
  type QuantityUnit
} from '../../../../shared/fleet'

// An item row as typed; the quantity stays a string until the form is submitted
export interface ItemDraft {
  key: number
  name: string
  quantity: string
  unit: ItemUnit
}

let nextKey = 0
export const newItemDraft = (unit: ItemUnit, item?: CargoItem): ItemDraft => ({
  key: nextKey++,
  name: item?.name ?? '',
  quantity: item ? String(item.quantity) : '',
  unit: item?.unit ?? unit
})

// Keeps the rows valid for a vehicle of another unit family (tons <-> liters): units that no
// longer fit switch to the vehicle's unit and lose their quantity
export function fitItemsTo(items: ItemDraft[], unit: QuantityUnit): ItemDraft[] {
  const allowed = itemUnitsFor(unit)
  return items.map((item) => (allowed.includes(item.unit) ? item : { ...item, unit, quantity: '' }))
}
