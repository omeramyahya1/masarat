import { randomBytes } from 'crypto'
import { and, eq } from 'drizzle-orm'
import QRCode from 'qrcode'
import { certificates, getDb, manifests, payments, users, vehicles, type Payment } from '../db'
import { missingForBilling, type FleetResult } from '../../shared/fleet'
import { calculateTaxes } from '../../shared/tax'
import {
  CERTIFICATE_VALID_DAYS,
  buildQrPayload,
  type CertificateRecord,
  type PaymentRecord,
  type TripDetails
} from '../../shared/billing'
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

const ownedTripColumns = { ...tripColumns, vehicleCapacity: vehicles.capacity }
type OwnedTrip = TripRow & { vehicleCapacity: number }

// The manifest with its vehicle, only if it belongs to this owner
function findOwnedTrip(ownerId: number, manifestId: unknown): OwnedTrip | undefined {
  if (typeof manifestId !== 'number') return undefined
  return getDb()
    .select(ownedTripColumns)
    .from(manifests)
    .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
    .where(and(eq(manifests.id, manifestId), eq(vehicles.ownerId, ownerId)))
    .get()
}

const paymentOf = (manifestId: number): Payment | undefined =>
  getDb().select().from(payments).where(eq(payments.manifestId, manifestId)).get()

// e.g. MSR-2026-000042
export const certificateNoFor = (manifestId: number, issuedAt: Date): string =>
  `MSR-${issuedAt.getFullYear()}-${String(manifestId).padStart(6, '0')}`

// End of the day CERTIFICATE_VALID_DAYS after the trip date
export function validUntilFor(tripDate: Date): Date {
  const end = new Date(tripDate)
  end.setDate(end.getDate() + CERTIFICATE_VALID_DAYS)
  end.setHours(23, 59, 59, 0)
  return end
}

export async function getTripDetails(
  ownerId: number,
  manifestId: number
): Promise<FleetResult<TripDetails>> {
  const row = findOwnedTrip(ownerId, manifestId)
  if (!row) return { ok: false, error: 'manifest_not_found' }
  const { vehicleCapacity, ...trip } = row

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
          issuedAt: certificate.issuedAt.getTime(),
          validUntil: certificate.validUntil.getTime(),
          qrDataUrl: await QRCode.toDataURL(buildQrPayload(payment.billId, trip.plateNumber), {
            errorCorrectionLevel: 'M',
            margin: 1,
            width: 320
          })
        }
      : null

  return {
    ok: true,
    data: {
      trip: toTripRecord(trip),
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

// Checks the bill with E-Sali; once paid, records the payment and issues the certificate
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
