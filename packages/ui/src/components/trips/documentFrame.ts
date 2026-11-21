// What every page of a printed document repeats, built from the issued certificate
import type { TFunction } from 'i18next'
import type { CertificateRecord } from '@masarat/shared/billing'
import type { Formatters } from '../../lib/format'

export interface SheetFrame {
  // Republic, ministry, authority and department, top to bottom
  authority: readonly string[]
  // Code 128 barcode of the document number (the number is printed under the bars); a report
  // has none
  barcode?: string
  barcodeAlt: string
  date: { label: string; value: string }
  title: string
  // The verification QR; a report has none
  qr?: string
  qrLabel: string
  footer: string
}

// The receipt's or the manifest's frame; documents are always in Arabic (ar, fa)
export function documentFrame(
  document: 'receipt' | 'manifest',
  certificate: CertificateRecord,
  ar: TFunction,
  fa: Formatters
): SheetFrame {
  const receipt = document === 'receipt'
  return {
    authority: [
      ar('certificate.header.republic'),
      ar('certificate.header.ministry'),
      ar('certificate.header.authority'),
      ar('certificate.header.department')
    ],
    barcode: receipt ? certificate.receiptBarcode : certificate.manifestBarcode,
    barcodeAlt: receipt ? certificate.certificateNo : certificate.manifestNo,
    date: { label: ar('certificate.fields.issuedAt'), value: fa.date(certificate.issuedAt) },
    title: receipt ? ar('certificate.header.title') : ar('certificate.manifest.title'),
    qr: certificate.qrDataUrl,
    qrLabel: ar('certificate.scanToVerify'),
    footer: receipt
      ? ar('certificate.footer')
      : ar('certificate.manifest.footer', { receiptNo: certificate.certificateNo })
  }
}
