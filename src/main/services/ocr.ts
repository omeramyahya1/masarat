// Reads supporting documents to fill in the trip form. SIMULATED for the MVP: MockOcrService
// waits a moment and returns one of a few realistic shipments, so the demo shows the flow. A real
// OCR / document AI service can replace it behind the OcrService interface.
import { statSync } from 'fs'
import { basename } from 'path'
import type { DocumentType, FleetResult, Party, QuantityUnit } from '../../shared/fleet'
import type { OcrItem, OcrResult, ScanInput } from '../../shared/ocr'
import { findStaged, isDocumentType, ownedDocumentPath, stagedPath } from './documents'

export interface OcrService {
  scan(
    docType: DocumentType,
    filePath: string,
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
    filePath: string,
    { unit, scenario }: { unit: QuantityUnit; scenario: number | null }
  ): Promise<OcrResult> {
    await new Promise((resolve) => setTimeout(resolve, SCAN_DELAY_MS))
    // The first document picks a shipment from its name and size; later ones reuse it
    const index =
      scenario !== null && scenario >= 0 && scenario < SHIPMENTS.length
        ? scenario
        : fingerprint(filePath) % SHIPMENTS.length
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
      case 'certificate_of_origin':
        return { scenario: index, tripKind: shipment.tripKind, shipper: shipment.shipper }
      case 'trade_authorization':
        return {
          scenario: index,
          tripKind: shipment.tripKind,
          shipper: shipment.shipper,
          receiver: shipment.receiver
        }
    }
  }
}

function fingerprint(filePath: string): number {
  const name = basename(filePath)
  let hash = statSync(filePath).size
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
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
  let filePath: string | undefined
  if (source && 'token' in source) {
    const staged = findStaged(source.token)
    filePath = staged ? stagedPath(staged) : undefined
  } else if (source && 'id' in source) {
    filePath = ownedDocumentPath(ownerId, source.id)
  }
  if (!filePath) return { ok: false, error: 'invalid_document' }
  const scenario = typeof input.scenario === 'number' ? input.scenario : null
  return {
    ok: true,
    data: await ocr.scan(input.docType, filePath, { unit: input.unit, scenario })
  }
}
