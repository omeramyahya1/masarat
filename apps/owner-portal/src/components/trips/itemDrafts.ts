// Cargo item rows as the trip form edits them
import {
  itemUnitsFor,
  type CargoItem,
  type CargoType,
  type ItemUnit,
  type QuantityUnit
} from '@masarat/shared/fleet'

// An item row as typed; numbers stay strings until the form is submitted
export interface ItemDraft {
  key: number
  cargoType: CargoType | ''
  name: string
  // The weight (or volume) in `unit`
  quantity: string
  unit: ItemUnit
  packingType: string
  packageCount: string
  notes: string
}

let nextKey = 0
export const newItemDraft = (
  unit: ItemUnit,
  cargoType: CargoType | '',
  item?: CargoItem
): ItemDraft => ({
  key: nextKey++,
  cargoType: item?.cargoType ?? cargoType,
  name: item?.name ?? '',
  quantity: item ? String(item.quantity) : '',
  unit: item?.unit ?? unit,
  packingType: item?.packingType ?? '',
  packageCount: item?.packageCount ? String(item.packageCount) : '',
  notes: item?.notes ?? ''
})

// Keeps the rows valid for another vehicle: units of the other family (tons <-> liters) switch
// to the vehicle's unit and lose their quantity, and cargo types it can't carry are cleared
export function fitItemsTo(
  items: ItemDraft[],
  unit: QuantityUnit,
  cargoTypes: readonly CargoType[]
): ItemDraft[] {
  const allowed = itemUnitsFor(unit)
  return items.map((item) => ({
    ...item,
    ...(allowed.includes(item.unit) ? {} : { unit, quantity: '' }),
    ...(item.cargoType && !cargoTypes.includes(item.cargoType) ? { cargoType: '' as const } : {})
  }))
}
