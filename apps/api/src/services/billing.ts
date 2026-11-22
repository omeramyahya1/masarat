import { randomBytes } from 'crypto'
import { and, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
// The Node build: the package's root export has no condition TypeScript's bundler resolution picks
import bwipjs from 'bwip-js/node'
import QRCode from 'qrcode'
import {
  certificates,
  companies,
  getDb,
  manifests,
  payments,
  users,
  vehicles,
  type Payment
} from '../db'
import { missingForBilling, type FleetResult } from '@masarat/shared/fleet'
import { calculateTaxes } from '@masarat/shared/tax'
import {
  CERTIFICATE_VALID_DAYS,
  verifyUrl,
  type CertificateRecord,
  type PaymentRecord,
  type TripDetails
} from '@masarat/shared/billing'
import { config } from '../config'
import { tripScopeCondition, type CompanyScope, type TripScope } from './access'
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

// Who booked the trip
const booker = alias(users, 'booker')

const ownedTripColumns = {
  ...tripColumns,
  vehicleCapacity: vehicles.capacity,
  company: companies,
  bookerName: booker.fullName,
  bookerPhone: booker.phone
}
type OwnedTrip = TripRow & {
  vehicleCapacity: number
  company: typeof companies.$inferSelect
  bookerName: string | null
  bookerPhone: string | null
}

// The manifest with its vehicle and company, if the scope may see it. A null scope is the
// government, which may open any trip.
async function findOwnedTrip(
  scope: TripScope,
  manifestId: unknown
): Promise<OwnedTrip | undefined> {
  if (typeof manifestId !== 'number') return undefined
  const [trip] = await getDb()
    .select(ownedTripColumns)
    .from(manifests)
    .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
    .innerJoin(companies, eq(vehicles.companyId, companies.id))
    .leftJoin(booker, eq(manifests.createdBy, booker.id))
    .where(and(eq(manifests.id, manifestId), tripScopeCondition(scope)))
    .limit(1)
  return trip
}

async function paymentOf(manifestId: number): Promise<Payment | undefined> {
  const [payment] = await getDb()
    .select()
    .from(payments)
    .where(eq(payments.manifestId, manifestId))
    .limit(1)
  return payment
}

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

// A trip with its bill and documents; the government passes a null scope
export async function getTripDetails(
  scope: TripScope,
  manifestId: number
): Promise<FleetResult<TripDetails>> {
  const row = await findOwnedTrip(scope, manifestId)
  if (!row) return { ok: false, error: 'manifest_not_found' }
  const { vehicleCapacity, company, bookerName, bookerPhone, ...trip } = row

  const payment = await paymentOf(trip.id)
  const [certificate] = await getDb()
    .select()
    .from(certificates)
    .where(eq(certificates.manifestId, trip.id))
    .limit(1)

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
          // A link to the public verify page, which officers scan at checkpoints
          qrDataUrl: await QRCode.toDataURL(verifyUrl(config.siteUrl, certificate.qrToken), {
            errorCorrectionLevel: 'M',
            margin: 1,
            width: 320
          }),
          receiptBarcode: barcodeDataUrl(certificate.certificateNo),
          manifestBarcode: barcodeDataUrl(certificate.manifestNo)
        }
      : null

  return {
    ok: true,
    data: {
      trip: await toTripRecord(trip),
      company: { id: company.id, name: company.name },
      bookedBy:
        bookerName !== null && bookerPhone !== null
          ? { fullName: bookerName, phone: bookerPhone }
          : null,
      vehicleCapacity,
      payment: paymentRecord,
      certificate: certificateRecord
    }
  }
}

// Asks E-Sali for a bill ID for the trip's taxes and fees, and moves the manifest to `billed`
export async function generateBill(
  scope: CompanyScope,
  manifestId: number
): Promise<FleetResult<TripDetails>> {
  const trip = await findOwnedTrip(scope, manifestId)
  if (!trip) return { ok: false, error: 'manifest_not_found' }
  // Asking twice returns the bill already issued instead of creating a second one
  if (await paymentOf(trip.id)) return getTripDetails(scope, trip.id)
  if (trip.status !== 'draft') return { ok: false, error: 'already_billed' }

  // The manifest has to be complete, including the company's carrier details
  const db = getDb()
  const { company } = trip
  const driver =
    trip.driverId === null ? undefined : await findOwnedDriver(scope.companyId, trip.driverId)
  if (!driver || missingForBilling(await toTripRecord(trip), company).length > 0) {
    return { ok: false, error: 'incomplete_manifest' }
  }

  // Billed at today's tax percentages and fees (they may have changed since the draft was
  // saved); the lines are frozen from here on, and so are the carrier and driver details
  const taxes = calculateTaxes(trip.tripCost, await getTaxSettings(db), await getFeeSettings(db))
  // With every rate and fee at 0 there is nothing to pay; E-Sali isn't asked for a bill
  if (taxes.total <= 0) return { ok: false, error: 'zero_bill' }
  const { billId } = await esali.createBill({ amount: taxes.total })
  await db.transaction(async (tx) => {
    await writeTaxes(tx, trip.id, taxes.lines)
    // manifest_id is unique, so a second bill for the trip fails here and rolls everything back
    await tx.insert(payments).values({ manifestId: trip.id, billId, amount: taxes.total })
    await tx
      .update(manifests)
      .set({
        status: 'billed',
        taxAmount: taxes.total,
        carrierName: company.name,
        carrierAddress: company.address,
        carrierTin: company.tin,
        driverName: driver.name,
        driverPhone: driver.phone
      })
      .where(eq(manifests.id, trip.id))
  })
  return getTripDetails(scope, trip.id)
}

// Checks the bill with E-Sali; once paid, records the payment and issues the receipt and the
// authorized manifest
export async function refreshBillStatus(
  scope: CompanyScope,
  manifestId: number
): Promise<FleetResult<TripDetails>> {
  const trip = await findOwnedTrip(scope, manifestId)
  if (!trip) return { ok: false, error: 'manifest_not_found' }
  const payment = await paymentOf(trip.id)
  if (!payment) return { ok: false, error: 'not_billed' }

  if (payment.status !== 'paid') {
    const bill = await esali.getBillStatus(payment.billId)
    if (bill?.status === 'paid') {
      const paidAt = bill.paidAt ?? new Date()
      const issuedAt = new Date()
      await getDb().transaction(async (tx) => {
        await tx
          .update(payments)
          .set({
            status: 'paid',
            paidAt,
            paymentRef: bill.paymentRef ?? null,
            bank: 'E-Sali'
          })
          .where(eq(payments.id, payment.id))
        await tx
          .insert(certificates)
          .values({
            manifestId: trip.id,
            certificateNo: certificateNoFor(trip.id, issuedAt),
            manifestNo: manifestNoFor(trip.id, issuedAt),
            qrToken: randomBytes(16).toString('hex'),
            issuedAt,
            validUntil: validUntilFor(trip.tripDate)
          })
          .onConflictDoNothing()
        await tx.update(manifests).set({ status: 'certified' }).where(eq(manifests.id, trip.id))
      })
    }
  }
  return getTripDetails(scope, trip.id)
}

// Demo only: pays the trip's bill at the simulated E-Sali. Our records change on the next refresh.
export async function simulatePayment(
  scope: CompanyScope,
  manifestId: number
): Promise<FleetResult<null>> {
  if (!config.demoMode) return { ok: false, error: 'forbidden' }
  const trip = await findOwnedTrip(scope, manifestId)
  if (!trip) return { ok: false, error: 'manifest_not_found' }
  const payment = await paymentOf(trip.id)
  if (!payment) return { ok: false, error: 'not_billed' }
  await esali.simulatePayment(payment.billId)
  return { ok: true, data: null }
}
