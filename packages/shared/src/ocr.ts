// Reading supporting documents to fill in the trip form. Shared by the scanner in the main process
// (src/main/services/ocr.ts) and the trip form.
import type { CargoType, DocumentType, ItemUnit, Party, QuantityUnit, TripKind } from './fleet'

// A cargo line read from an invoice or packing list
export interface OcrItem {
  name: string
  quantity: number
  unit: ItemUnit
  cargoType: CargoType
  packingType: string | null
  packageCount: number | null
}

// What a document yielded; fields it doesn't carry are left out
export interface OcrResult {
  // Which shipment the simulated scanner read. The form sends it back with the next scan, so all
  // the documents of one trip describe the same shipment.
  scenario: number
  tripKind?: TripKind
  shipper?: Party
  receiver?: Party
  items?: OcrItem[]
}

export interface ScanInput {
  docType: DocumentType
  // A file picked on the form (staging token) or one already saved with the trip
  source: { token: string } | { id: number }
  // The vehicle's unit, so the cargo read is something it can carry
  unit: QuantityUnit
  scenario: number | null
}
