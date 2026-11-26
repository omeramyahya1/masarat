import { randomBytes } from 'crypto'
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm'
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
  tripViews,
  users,
  vehicles,
  type Payment
} from '../db'
import { missingForBilling, type FleetResult } from '@masarat/shared/fleet'
import { calculateCharges, type TripCategory } from '@masarat/shared/tax'
import {
  verifyUrl,
  type CertificateRecord,
  type PaymentRecord,
  type TripDetails
} from '@masarat/shared/billing'
import { config } from '../config'
import { tripScopeCondition, type CompanyScope, type TripScope } from './access'
import { listCharges } from './charges'
import { pricing } from './pricing'
import { getSettings } from './settings'
import { addPaidTrip } from './dailyRevenue'
import { findOwnedDriver } from './drivers'
import { esali } from './esali'
import { reviewOf } from './reviews'
import { toTripRecord, tripColumns, writeCharges, type TripRow } from './trips'

// Who booked the trip
const booker = alias(users, 'booker')

// A trip's page reads live and archived trips alike (the all_* views); billing writes go to the
// live tables, which an archived trip isn't in, so it can't be billed or changed
const v = tripViews

const ownedTripColumns = {
  ...tripColumns,
  vehicleCapacity: vehicles.capacity,
  company: companies,
  bookerName: booker.fullName,
  bookerPhone: booker.phone,
  // Moved to the archive: shown read-only
  archived: sql<boolean>`NOT EXISTS (SELECT 1 FROM ${manifests} WHERE ${manifests.id} = ${v.manifests.id})`
}
type OwnedTrip = TripRow & {
  vehicleCapacity: number
  company: typeof companies.$inferSelect
  bookerName: string | null
  bookerPhone: string | null
  archived: boolean
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
    .from(v.manifests)
    .innerJoin(vehicles, eq(v.manifests.vehicleId, vehicles.id))
    .innerJoin(companies, eq(vehicles.companyId, companies.id))
    .leftJoin(booker, eq(v.manifests.createdBy, booker.id))
    .where(and(eq(v.manifests.id, manifestId), tripScopeCondition(scope, v.manifests)))
    .limit(1)
  return trip
}

async function paymentOf(manifestId: number): Promise<Payment | undefined> {
  const [payment] = await getDb()
    .select()
    .from(v.payments)
    .where(eq(v.payments.manifestId, manifestId))
    .limit(1)
  return payment
}

const documentNo = (prefix: string, manifestId: number, issuedAt: Date): string =>
  `${prefix}-${issuedAt.getFullYear()}-${String(manifestId).padStart(6, '0')}`

// The electronic payment receipt's number, e.g. MSR-2026-000042
export const certificateNoFor = (manifestId: number, issuedAt: Date): string =>
  documentNo('MSR', manifestId, issuedAt)

// The authorized manifest's number: MNF-2026-000042 for cargo, PSG-2026-000042 for a passenger
// manifest (كشف ركاب), so an officer tells which it is from the number
export const manifestNoFor = (
  manifestId: number,
  issuedAt: Date,
  category: TripCategory = 'cargo'
): string => documentNo(category === 'passenger' ? 'PSG' : 'MNF', manifestId, issuedAt)

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

// The documents stay valid until the estimated arrival plus the government's margin for the kind
// of trip (Settings), so a manifest can't serve a later trip
export const validUntilFor = (arrivalAt: Date, marginHours: number): Date =>
  new Date(arrivalAt.getTime() + marginHours * 3_600_000)

// A trip with its bill and documents; the government passes a null scope
export async function getTripDetails(
  scope: TripScope,
  manifestId: number
): Promise<FleetResult<TripDetails>> {
  const row = await findOwnedTrip(scope, manifestId)
  if (!row) return { ok: false, error: 'manifest_not_found' }
  const { vehicleCapacity, company, bookerName, bookerPhone, archived, ...trip } = row

  const payment = await paymentOf(trip.id)
  const [certificate] = await getDb()
    .select()
    .from(v.certificates)
    .where(eq(v.certificates.manifestId, trip.id))
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

  // A revoked clearance's receipt and manifest are no longer valid: the company doesn't get them
  // (the trip page shows the revocation instead); the government still sees them
  const withheld = scope !== null && trip.status === 'revoked'
  const certificateRecord: CertificateRecord | null =
    certificate && payment && !withheld
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

  // The supervisor's decision for both sides; the reports only for the government
  const review = await reviewOf(trip.id, scope === null)

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
      certificate: certificateRecord,
      archived,
      ...review
    }
  }
}

// Asks E-Sali for a bill ID for the trip's taxes and fees, and moves the manifest to `billed`
export async function generateBill(
  scope: CompanyScope,
  manifestId: number
): Promise<FleetResult<TripDetails>> {
  if (!(await findOwnedTrip(scope, manifestId))) return { ok: false, error: 'manifest_not_found' }
  const db = getDb()
  const result = await db.transaction(async (tx): Promise<FleetResult<null>> => {
    // The trip's row stays locked until the bill is written: an edit saved meanwhile (updateTrip
    // takes the same lock) waits, so the bill is priced from the draft it's issued for
    const [locked] = await tx
      .select({ id: manifests.id })
      .from(manifests)
      .where(eq(manifests.id, manifestId))
      .for('update')
    // Read again under the lock (also checks it's still within the member's scope)
    const trip = locked ? await findOwnedTrip(scope, manifestId) : undefined
    if (!trip) return { ok: false, error: 'manifest_not_found' }
    // Asking twice returns the bill already issued instead of creating a second one
    if (await paymentOf(trip.id)) return { ok: true, data: null }
    if (trip.status !== 'draft') return { ok: false, error: 'already_billed' }

    // The manifest has to be complete, including the company's carrier details
    const { company } = trip
    const driver =
      trip.driverId === null ? undefined : await findOwnedDriver(scope.companyId, trip.driverId)
    if (!driver || missingForBilling(await toTripRecord(trip), company).length > 0) {
      return { ok: false, error: 'incomplete_manifest' }
    }

    // Billed at today's ticket price and taxes and fees (they may have changed since the draft
    // was saved); the lines are frozen from here on, and so are the carrier and driver details
    const passenger = trip.category === 'passenger'
    const ticketPrice = passenger ? await pricing.ticketPrice(trip.distanceKm, tx) : null
    const tripCost = ticketPrice === null ? trip.tripCost : ticketPrice * trip.cargoQuantity
    const taxes = calculateCharges(tripCost, await listCharges(tx), trip.category)
    // With every rate and fee at 0 there is nothing to pay; E-Sali isn't asked for a bill
    if (taxes.total <= 0) return { ok: false, error: 'zero_bill' }
    const { billId } = await esali.createBill({ amount: taxes.total })
    await writeCharges(tx, trip.id, taxes.lines)
    // manifest_id is unique, so a second bill for the trip fails here and rolls everything back
    await tx.insert(payments).values({ manifestId: trip.id, billId, amount: taxes.total })
    await tx
      .update(manifests)
      .set({
        status: 'billed',
        tripCost,
        ...(passenger ? { ticketPrice, ratePerKm: await pricing.ticketRatePerKm(tx) } : {}),
        taxAmount: taxes.total,
        carrierName: company.name,
        carrierAddress: company.address,
        carrierTin: company.tin,
        driverName: driver.name,
        driverPhone: driver.phone
      })
      .where(eq(manifests.id, trip.id))
    return { ok: true, data: null }
  })
  return result.ok ? getTripDetails(scope, manifestId) : result
}

// Checks the bill with E-Sali; once paid, records the payment and issues the receipt and the
// authorized manifest. A trip a supervisor cancelled is never authorized, whatever E-Sali says.
export async function refreshBillStatus(
  scope: CompanyScope,
  manifestId: number
): Promise<FleetResult<TripDetails>> {
  const trip = await findOwnedTrip(scope, manifestId)
  if (!trip) return { ok: false, error: 'manifest_not_found' }
  if (trip.status === 'cancelled') return { ok: false, error: 'trip_cancelled' }
  const payment = await paymentOf(trip.id)
  if (!payment) return { ok: false, error: 'not_billed' }

  if (payment.status !== 'paid') {
    const bill = await esali.getBillStatus(payment.billId)
    if (bill?.status === 'paid') {
      const paidAt = bill.paidAt ?? new Date()
      const issuedAt = new Date()
      await getDb().transaction(async (tx) => {
        // The trip first, as cancelTrip locks it: a supervisor cancelling it at the same moment
        // either waits for this, or has already cancelled it and nothing is recorded
        const [locked] = await tx
          .select({ status: manifests.status })
          .from(manifests)
          .where(eq(manifests.id, trip.id))
          .for('update')
        if (!locked || !['billed', 'paid'].includes(locked.status)) return
        // Only one refresh records the payment, even when two run at once: the other finds it
        // paid already and changes nothing (the summary must count it once)
        const recorded = await tx
          .update(payments)
          .set({
            status: 'paid',
            paidAt,
            paymentRef: bill.paymentRef ?? null,
            bank: 'E-Sali'
          })
          .where(
            and(eq(payments.id, payment.id), notInArray(payments.status, ['paid', 'cancelled']))
          )
          .returning({ id: payments.id })
        if (recorded.length === 0) return
        await addPaidTrip(tx, trip.id)
        await tx
          .insert(certificates)
          .values({
            manifestId: trip.id,
            certificateNo: certificateNoFor(trip.id, issuedAt),
            manifestNo: manifestNoFor(trip.id, issuedAt, trip.category),
            qrToken: randomBytes(16).toString('hex'),
            issuedAt,
            validUntil: validUntilFor(
              trip.arrivalAt,
              (await getSettings()).validityMarginHours[trip.category]
            )
          })
          .onConflictDoNothing()
        await tx
          .update(manifests)
          .set({ status: 'certified' })
          .where(and(eq(manifests.id, trip.id), inArray(manifests.status, ['billed', 'paid'])))
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
  if (trip.status === 'cancelled') return { ok: false, error: 'trip_cancelled' }
  const payment = await paymentOf(trip.id)
  if (!payment) return { ok: false, error: 'not_billed' }
  await esali.simulatePayment(payment.billId)
  return { ok: true, data: null }
}
