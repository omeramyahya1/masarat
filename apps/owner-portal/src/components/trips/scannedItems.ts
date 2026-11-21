// Merging cargo read from a scanned document into the form's item rows
import type { QuantityUnit } from '@masarat/shared/fleet'
import type { OcrItem } from '@masarat/shared/ocr'
import { newItemDraft, type ItemDraft } from './itemDrafts'

const isBlank = (item: ItemDraft): boolean => !item.name.trim() && item.quantity === ''

// A form still showing only empty rows takes the scanned items as they are. Otherwise each scanned
// item fills in the row with the same description (its packing, and its weight if that's empty),
// or is added as a new row. Returns the rows and the keys of the ones the scan touched.
export function mergeScannedItems(
  items: readonly ItemDraft[],
  scanned: readonly OcrItem[],
  unit: QuantityUnit
): { items: ItemDraft[]; touched: number[] } {
  const toDraft = (item: OcrItem): ItemDraft =>
    newItemDraft(unit, item.cargoType, { ...item, notes: null })

  if (items.every(isBlank)) {
    const drafts = scanned.map(toDraft)
    return { items: drafts, touched: drafts.map((d) => d.key) }
  }

  const next = [...items]
  const touched: number[] = []
  for (const item of scanned) {
    const index = next.findIndex((row) => row.name.trim() === item.name)
    if (index === -1) {
      const draft = toDraft(item)
      next.push(draft)
      touched.push(draft.key)
      continue
    }
    const row = next[index]
    const weightMissing = row.quantity === ''
    next[index] = {
      ...row,
      ...(weightMissing
        ? { quantity: String(item.quantity), unit: item.unit, cargoType: item.cargoType }
        : {}),
      ...(item.packingType ? { packingType: item.packingType } : {}),
      ...(item.packageCount ? { packageCount: String(item.packageCount) } : {})
    }
    touched.push(row.key)
  }
  return { items: next, touched }
}
