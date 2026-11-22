// E-Sali bills, payments and certificates, shared by the main process and the renderer
import type { TripKind, TripRecord } from './fleet'

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

// The documents issued once a bill is paid: the electronic payment receipt and the authorized
// manifest (تصريح الحركة). Both carry the same verification QR code.
export interface CertificateRecord {
  // The receipt's number (MSR-yyyy-xxxxxx)
  certificateNo: string
  // The manifest's number (MNF-yyyy-xxxxxx)
  manifestNo: string
  issuedAt: number
  validUntil: number
  // PNG data URL of the verification QR code
  qrDataUrl: string
  // SVG data URLs of each document's Code 128 barcode of its own number
  receiptBarcode: string
  manifestBarcode: string
}

export interface TripDetails {
  trip: TripRecord
  // The company the trip belongs to, and the member who booked it (shown in the government's view)
  company: { id: number; name: string }
  bookedBy: { fullName: string; phone: string } | null
  vehicleCapacity: number
  payment: PaymentRecord | null
  certificate: CertificateRecord | null
}

// What the documents' QR code encodes: the public verify page for this certificate, e.g.
// https://masarat.com/verify/<qr_token>. Anyone who scans it sees whether the manifest is valid.
export const verifyUrl = (siteUrl: string, qrToken: string): string =>
  `${siteUrl.replace(/\/+$/, '')}/verify/${qrToken}`

// certificates.qr_token: 32 lowercase hex characters
export const QR_TOKEN_PATTERN = /^[0-9a-f]{32}$/

// What the public verify page shows: enough for an officer to match the printed copy, and no
// personal contacts (no sender, receiver or driver details)
export interface ManifestVerification {
  // Valid until the end of its validity date; expired after
  status: 'valid' | 'expired'
  manifestNo: string
  certificateNo: string
  plateNumber: string
  tripKind: TripKind
  origin: { name: string; nameAr: string }
  destination: { name: string; nameAr: string }
  tripDate: number
  issuedAt: number
  validUntil: number
  // The carrier printed on the manifest
  carrierName: string
  amountPaid: number
  // When the API answered
  checkedAt: number
}

// A trip found by the government search
export interface GovtSearchInput {
  // Bill ID, MNF-/MSR- number, trip number, plate, company or city name; may be empty when a
  // route is given
  query: string
  originCityId?: number | null
  destinationCityId?: number | null
  // 1-based; 50 per page unless 25 or 100 is asked for
  page?: number
  pageSize?: number
}

export interface GovtSearchResult {
  manifestId: number
  manifestNo: string | null
  billId: string | null
  companyName: string
  plateNumber: string
  originCityId: number
  destinationCityId: number
  tripDate: number
  amount: number
  status: TripRecord['status']
}
