import { randomBytes } from 'crypto'
import { and, eq } from 'drizzle-orm'
// The Node build: the package's root export has no condition TypeScript's bundler resolution picks
import bwipjs from 'bwip-js/node'
import QRCode from 'qrcode'
import { certificates, getDb, manifests, payments, users, vehicles, type Payment } from '../db'
import { missingForBilling, type FleetResult } from '@masarat/shared/fleet'
import { calculateTaxes } from '@masarat/shared/tax'
import {
  CERTIFICATE_VALID_DAYS,
  buildQrPayload,
  type CertificateRecord,
  type PaymentRecord,
  type TripDetails
} from '@masarat/shared/billing'
import { findOwnedDriver } from './drivers'
import { esali } from './esali'
import {
  getFeeSettings,
  getTaxSettings,
  toTripRecord,
  tripColumns,
  writeTaxes,
  type TripRow
} from './trips'

const ownedTripColumns = {
  ...tripColumns,
  vehicleCapacity: vehicles.capacity,
  ownerCompany: users.companyName,
  ownerName: users.fullName,
  ownerPhone: users.phone
}
type OwnedTrip = TripRow & {
  vehicleCapacity: number
  ownerCompany: string | null
  ownerName: string
  ownerPhone: string | null
}

// The manifest with its vehicle and owner, if it belongs to this owner. A null owner is the
// government, which may open any trip.
function findOwnedTrip(ownerId: number | null, manifestId: unknown): OwnedTrip | undefined {
  if (typeof manifestId !== 'number') return undefined
  return getDb()
    .select(ownedTripColumns)
    .from(manifests)
    .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
    .innerJoin(users, eq(vehicles.ownerId, users.id))
    .where(
      and(
        eq(manifests.id, manifestId),
        ownerId === null ? undefined : eq(vehicles.ownerId, ownerId)
      )
    )
    .get()
}

const paymentOf = (manifestId: number): Payment | undefined =>
  getDb().select().from(payments).where(eq(payments.manifestId, manifestId)).get()

const documentNo = (prefix: string, manifestId: number, issuedAt: Date): string =>
  `${prefix}-${issuedAt.getFullYear()}-${String(manifestId).padStart(6, '0')}`

// The electronic payment receipt's number, e.g. MSR-2026-000042
export const certificateNoFor = (manifestId: number, issuedAt: Date): string =>
  documentNo('MSR', manifestId, issuedAt)

// The authorized manifest's number, e.g. MNF-2026-000042
export const manifestNoFor = (manifestId: number, issuedAt: Date): string =>
  documentNo('MNF', manifestId, issuedAt)

// A Code 128 barcode of a document number, with the number printed under it, as an SVG data URL
function barcodeDataUrl(text: string): string {
  const svg = bwipjs.toSVG({
    bcid: 'code128',
    text,
    height: 10,
    includetext: true,
    textxalign: 'center',
    textsize: 9
  })
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

// End of the day CERTIFICATE_VALID_DAYS after the trip date
export function validUntilFor(tripDate: Date): Date {
  const end = new Date(tripDate)
  end.setDate(end.getDate() + CERTIFICATE_VALID_DAYS)
  end.setHours(23, 59, 59, 0)
  return end
}

// A trip with its bill and documents; the government passes a null owner
export async function getTripDetails(
  ownerId: number | null,
  manifestId: number
): Promise<FleetResult<TripDetails>> {
  const row = findOwnedTrip(ownerId, manifestId)
  if (!row) return { ok: false, error: 'manifest_not_found' }
  const { vehicleCapacity, ownerCompany, ownerName, ownerPhone, ...trip } = row

  const payment = paymentOf(trip.id)
  const certificate = getDb()
    .select()
    .from(certificates)
    .where(eq(certificates.manifestId, trip.id))
    .get()

  const paymentRecord: PaymentRecord | null = payment
    ? {
        billId: payment.billId,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        paymentRef: payment.paymentRef,
        paidAt: payment.paidAt?.getTime() ?? null,
        createdAt: payment.createdAt.getTime()
      }
    : null

  const certificateRecord: CertificateRecord | null =
    certificate && payment
      ? {
          certificateNo: certificate.certificateNo,
          manifestNo: certificate.manifestNo,
          issuedAt: certificate.issuedAt.getTime(),
          validUntil: certificate.validUntil.getTime(),
          qrDataUrl: await QRCode.toDataURL(
            buildQrPayload(payment.billId, trip.plateNumber, certificate.manifestNo),
            { errorCorrectionLevel: 'M', margin: 1, width: 320 }
          ),
          receiptBarcode: barcodeDataUrl(certificate.certificateNo),
          manifestBarcode: barcodeDataUrl(certificate.manifestNo)
        }
      : null

  return {
    ok: true,
    data: {
      trip: toTripRecord(trip),
      owner: { companyName: ownerCompany || ownerName, fullName: ownerName, phone: ownerPhone },
      vehicleCapacity,
      payment: paymentRecord,
      certificate: certificateRecord
    }
  }
}

// Asks E-Sali for a bill ID for the trip's taxes and fees, and moves the manifest to `billed`
export async function generateBill(
  ownerId: number,
  manifestId: number
): Promise<FleetResult<TripDetails>> {
  const trip = findOwnedTrip(ownerId, manifestId)
  if (!trip) return { ok: false, error: 'manifest_not_found' }
  // Asking twice returns the bill already issued instead of creating a second one
  if (paymentOf(trip.id)) return getTripDetails(ownerId, trip.id)
  if (trip.status !== 'draft') return { ok: false, error: 'already_billed' }

  // The manifest has to be complete, including the owner's carrier details
  const db = getDb()
  const owner = db.select().from(users).where(eq(users.id, ownerId)).get()
  const driver = trip.driverId === null ? undefined : findOwnedDriver(ownerId, trip.driverId)
  if (!owner || !driver || missingForBilling(toTripRecord(trip), owner).length > 0) {
    return { ok: false, error: 'incomplete_manifest' }
  }

  // Billed at today's tax percentages and fees (they may have changed since the draft was
  // saved); the lines are frozen from here on, and so are the carrier and driver details
  const taxes = calculateTaxes(trip.tripCost, getTaxSettings(db), getFeeSettings(db))
  // With every rate and fee at 0 there is nothing to pay; E-Sali isn't asked for a bill
  if (taxes.total <= 0) return { ok: false, error: 'zero_bill' }
  const { billId } = esali.createBill({ amount: taxes.total })
  db.transaction((tx) => {
    writeTaxes(tx, trip.id, taxes.lines)
    tx.insert(payments).values({ manifestId: trip.id, billId, amount: taxes.total }).run()
    tx.update(manifests)
      .set({
        status: 'billed',
        taxAmount: taxes.total,
        carrierName: owner.companyName || owner.fullName,
        carrierAddress: owner.address,
        carrierTin: owner.tin,
        driverName: driver.name,
        driverPhone: driver.phone
      })
      .where(eq(manifests.id, trip.id))
      .run()
  })
  return getTripDetails(ownerId, trip.id)
}

// Checks the bill with E-Sali; once paid, records the payment and issues the receipt and the
// authorized manifest
export async function refreshBillStatus(
  ownerId: number,
  manifestId: number
): Promise<FleetResult<TripDetails>> {
  const trip = findOwnedTrip(ownerId, manifestId)
  if (!trip) return { ok: false, error: 'manifest_not_found' }
  const payment = paymentOf(trip.id)
  if (!payment) return { ok: false, error: 'not_billed' }

  if (payment.status !== 'paid') {
    const bill = esali.getBillStatus(payment.billId)
    if (bill?.status === 'paid') {
      const paidAt = bill.paidAt ?? new Date()
      const issuedAt = new Date()
      getDb().transaction((tx) => {
        tx.update(payments)
          .set({
            status: 'paid',
            paidAt,
            paymentRef: bill.paymentRef ?? null,
            bank: 'E-Sali'
          })
          .where(eq(payments.id, payment.id))
          .run()
        tx.insert(certificates)
          .values({
            manifestId: trip.id,
            certificateNo: certificateNoFor(trip.id, issuedAt),
            manifestNo: manifestNoFor(trip.id, issuedAt),
            qrToken: randomBytes(16).toString('hex'),
            issuedAt,
            validUntil: validUntilFor(trip.tripDate)
          })
          .onConflictDoNothing()
          .run()
        tx.update(manifests).set({ status: 'certified' }).where(eq(manifests.id, trip.id)).run()
      })
    }
  }
  return getTripDetails(ownerId, trip.id)
}

// Demo only: pays the trip's bill at the simulated E-Sali. Our records change on the next refresh.
export function simulatePayment(ownerId: number, manifestId: number): FleetResult<null> {
  const trip = findOwnedTrip(ownerId, manifestId)
  if (!trip) return { ok: false, error: 'manifest_not_found' }
  const payment = paymentOf(trip.id)
  if (!payment) return { ok: false, error: 'not_billed' }
  esali.simulatePayment(payment.billId)
  return { ok: true, data: null }
}
