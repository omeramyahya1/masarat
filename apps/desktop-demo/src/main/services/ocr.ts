// Reads supporting documents to fill in the trip form. SIMULATED for the MVP: MockOcrService
// waits a moment and returns one of a few realistic shipments, so the demo shows the flow. A real
// OCR / document AI service can replace it behind the OcrService interface.
import { statSync } from 'fs'
import type { DocumentType, FleetResult, Party, QuantityUnit } from '../../shared/fleet'
import type { OcrItem, OcrResult, ScanInput } from '../../shared/ocr'
import { findOwnedDocumentFile, findStaged, isDocumentType, stagedPath } from './documents'

// The document describes a different shipment from the one the trip's other documents described
export class ScanConflictError extends Error {}

export interface OcrService {
  // fileName is the name the owner's file had (the stored copy is renamed). Throws
  // ScanConflictError when the document can't belong to the shipment already read (`scenario`).
  scan(
    docType: DocumentType,
    file: { path: string; fileName: string },
    options: { unit: QuantityUnit; scenario: number | null }
  ): Promise<OcrResult>
}

// One shipment as its documents describe it, with the cargo for a truck and for a tanker
interface Shipment {
  tripKind: 'domestic' | 'import' | 'export'
  shipper: Party
  receiver: Party
  cargo: Record<QuantityUnit, OcrItem[]>
}

const SHIPMENTS: readonly Shipment[] = [
  {
    tripKind: 'import',
    shipper: {
      name: 'شركة البحر الأحمر للتوكيلات الملاحية',
      address: 'بورتسودان، الميناء الجنوبي',
      phone: '0912456781'
    },
    receiver: {
      name: 'شركة الخرطوم للمواد الغذائية',
      address: 'الخرطوم بحري، المنطقة الصناعية',
      phone: '0918234567'
    },
    cargo: {
      ton: [
        {
          name: 'سكر أبيض',
          quantity: 18,
          unit: 'ton',
          cargoType: 'general_cargo',
          packingType: 'شوالات',
          packageCount: 360
        },
        {
          name: 'أرز',
          quantity: 6,
          unit: 'ton',
          cargoType: 'general_cargo',
          packingType: 'شوالات',
          packageCount: 240
        }
      ],
      liter: [
        {
          name: 'زيت طعام',
          quantity: 20000,
          unit: 'liter',
          cargoType: 'liquids',
          packingType: 'براميل',
          packageCount: 100
        }
      ]
    }
  },
  {
    tripKind: 'export',
    shipper: {
      name: 'شركة كردفان للصمغ العربي',
      address: 'الأبيض، السوق الكبير',
      phone: '0915678234'
    },
    receiver: {
      name: 'وكالة الشرق للشحن والتخليص',
      address: 'بورتسودان، الميناء الشمالي',
      phone: '0912345098'
    },
    cargo: {
      ton: [
        {
          name: 'صمغ عربي',
          quantity: 12,
          unit: 'ton',
          cargoType: 'general_cargo',
          packingType: 'شوالات',
          packageCount: 240
        },
        {
          name: 'سمسم',
          quantity: 8,
          unit: 'ton',
          cargoType: 'general_cargo',
          packingType: 'شوالات',
          packageCount: 160
        }
      ],
      liter: [
        {
          name: 'دبس (مولاس)',
          quantity: 30000,
          unit: 'liter',
          cargoType: 'liquids',
          packingType: 'سائب',
          packageCount: 1
        }
      ]
    }
  },
  {
    tripKind: 'domestic',
    shipper: {
      name: 'مصنع عطبرة للأسمنت',
      address: 'عطبرة، المنطقة الصناعية',
      phone: '0913456712'
    },
    receiver: {
      name: 'شركة النهضة للمواد الإنشائية',
      address: 'ود مدني، السوق الكبير',
      phone: '0911223344'
    },
    cargo: {
      ton: [
        {
          name: 'أسمنت',
          quantity: 25,
          unit: 'ton',
          cargoType: 'general_cargo',
          packingType: 'شوالات',
          packageCount: 500
        },
        {
          name: 'حديد تسليح',
          quantity: 5,
          unit: 'ton',
          cargoType: 'general_cargo',
          packingType: 'بالات',
          packageCount: 25
        }
      ],
      liter: [
        {
          name: 'مياه شرب',
          quantity: 30000,
          unit: 'liter',
          cargoType: 'liquids',
          packingType: 'سائب',
          packageCount: 1
        }
      ]
    }
  }
]

const SCAN_DELAY_MS = 1500

class MockOcrService implements OcrService {
  async scan(
    docType: DocumentType,
    file: { path: string; fileName: string },
    { unit, scenario }: { unit: QuantityUnit; scenario: number | null }
  ): Promise<OcrResult> {
    await new Promise((resolve) => setTimeout(resolve, SCAN_DELAY_MS))
    // The first document picks a shipment from its name and size; later ones reuse it
    let index: number
    if (scenario !== null && scenario >= 0 && scenario < SHIPMENTS.length) {
      // Later documents have to describe the same shipment, so a certificate of origin can't
      // follow an export's invoice: report it rather than switch the trip's type
      if (!fits(docType, SHIPMENTS[scenario])) throw new ScanConflictError()
      index = scenario
    } else {
      // The first document picks, from its name and size, among the shipments it can belong to
      const candidates = SHIPMENTS.flatMap((shipment, i) => (fits(docType, shipment) ? [i] : []))
      index = candidates[fingerprint(file) % candidates.length]
    }
    const shipment = SHIPMENTS[index]
    const cargo = shipment.cargo[unit]
    switch (docType) {
      // The invoice names the parties and the goods, but not how they're packed
      case 'commercial_invoice':
        return {
          scenario: index,
          shipper: shipment.shipper,
          receiver: shipment.receiver,
          items: cargo.map((item) => ({ ...item, packingType: null, packageCount: null }))
        }
      case 'packing_list':
        return { scenario: index, items: cargo }
      // fits() keeps these to imports (certificate of origin) and imports or exports
      case 'certificate_of_origin':
      case 'trade_authorization':
        return {
          scenario: index,
          tripKind: shipment.tripKind,
          shipper: shipment.shipper,
          ...(docType === 'trade_authorization' ? { receiver: shipment.receiver } : {})
        }
    }
  }
}

// Only imports come with a certificate of origin, and only imports and exports need an
// authorization; the invoice and packing list go with any shipment
function fits(docType: DocumentType, shipment: Shipment): boolean {
  if (docType === 'certificate_of_origin') return shipment.tripKind === 'import'
  if (docType === 'trade_authorization') return shipment.tripKind !== 'domestic'
  return true
}

// The same file always reads as the same shipment
function fingerprint({ path, fileName }: { path: string; fileName: string }): number {
  let hash = statSync(path).size
  for (let i = 0; i < fileName.length; i++) hash = (hash * 31 + fileName.charCodeAt(i)) >>> 0
  return hash
}

export const ocr: OcrService = new MockOcrService()

// Scans a staged or saved attachment of the signed-in owner
export async function scanDocument(
  ownerId: number,
  input: ScanInput
): Promise<FleetResult<OcrResult>> {
  if (!input || !isDocumentType(input.docType)) return { ok: false, error: 'invalid_document' }
  if (input.unit !== 'ton' && input.unit !== 'liter') return { ok: false, error: 'missing_fields' }
  const source = input.source
  let file: { path: string; fileName: string } | undefined
  if (source && 'token' in source) {
    const staged = findStaged(source.token)
    file = staged ? { path: stagedPath(staged), fileName: staged.fileName } : undefined
  } else if (source && 'id' in source) {
    file = findOwnedDocumentFile(ownerId, source.id)
  }
  if (!file) return { ok: false, error: 'invalid_document' }
  const scenario = typeof input.scenario === 'number' ? input.scenario : null
  try {
    return { ok: true, data: await ocr.scan(input.docType, file, { unit: input.unit, scenario }) }
  } catch (err) {
    if (err instanceof ScanConflictError) return { ok: false, error: 'scan_conflict' }
    throw err
  }
}
