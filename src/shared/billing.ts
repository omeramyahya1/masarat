// E-Sali bills, payments and certificates, shared by the main process and the renderer
import type { TripRecord } from './fleet'

// yyyy mm 0dd (day as 3 digits) + 13 digits, e.g. 2026110170000123456789
export const ESALI_BILL_ID_RE = /^\d{4}(0[1-9]|1[0-2])0(0[1-9]|[12]\d|3[01])\d{13}$/

export const isEsaliBillId = (value: unknown): value is string =>
  typeof value === 'string' && ESALI_BILL_ID_RE.test(value)

// Certificates stay valid until the end of this many days after the trip date
export const CERTIFICATE_VALID_DAYS = 30

export interface PaymentRecord {
  billId: string
  amount: number
  currency: string
  status: 'pending' | 'paid' | 'expired' | 'failed'
  paymentRef: string | null
  paidAt: number | null
  createdAt: number
}

export interface CertificateRecord {
  certificateNo: string
  issuedAt: number
  validUntil: number
  // PNG data URL of the QR code
  qrDataUrl: string
}

export interface TripDetails {
  trip: TripRecord
  vehicleCapacity: number
  payment: PaymentRecord | null
  certificate: CertificateRecord | null
}

// What the certificate's QR code encodes. Later this becomes a URL to a page that shows the
// manifest's live status (looked up by the certificate's qr_token).
export function buildQrPayload(billId: string, plateNumber: string): string {
  return JSON.stringify({ esaliBillId: billId, status: 'paid', plate: plateNumber })
}
