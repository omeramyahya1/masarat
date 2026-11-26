// The public verify page's lookup: a certificate by its QR token, with only what an officer needs
// to match the printed copy. Nothing personal (sender, receiver, driver, passengers' names or IDs)
// leaves here: a passenger trip only gives its head count.
import { and, count, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { cities, getDb, tripViews, vehicles } from '../db'
import { QR_TOKEN_PATTERN, type ManifestVerification } from '@masarat/shared/billing'
import type { FleetResult } from '@masarat/shared/fleet'

// Reads live and archived trips alike (the all_* views)
const { certificates, manifests, payments, tripPassengers } = tripViews

const origin = alias(cities, 'verify_origin')
const destination = alias(cities, 'verify_destination')

export async function verifyManifest(
  token: string,
  now = new Date()
): Promise<FleetResult<ManifestVerification>> {
  if (!QR_TOKEN_PATTERN.test(token)) return { ok: false, error: 'manifest_not_found' }
  const [row] = await getDb()
    .select({
      manifestNo: certificates.manifestNo,
      certificateNo: certificates.certificateNo,
      issuedAt: certificates.issuedAt,
      validUntil: certificates.validUntil,
      plateNumber: vehicles.plateNumber,
      tripKind: manifests.tripKind,
      manifestId: manifests.id,
      category: manifests.category,
      departureAt: manifests.departureAt,
      arrivalAt: manifests.arrivalAt,
      carrierName: manifests.carrierName,
      originName: origin.name,
      originNameAr: origin.nameAr,
      destinationName: destination.name,
      destinationNameAr: destination.nameAr,
      amountPaid: payments.amount
    })
    .from(certificates)
    .innerJoin(manifests, eq(certificates.manifestId, manifests.id))
    .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
    .innerJoin(origin, eq(manifests.originCityId, origin.id))
    .innerJoin(destination, eq(manifests.destinationCityId, destination.id))
    // Only a paid bill's documents count
    .innerJoin(payments, and(eq(payments.manifestId, manifests.id), eq(payments.status, 'paid')))
    .where(eq(certificates.qrToken, token))
    .limit(1)
  if (!row) return { ok: false, error: 'manifest_not_found' }

  let passengers: ManifestVerification['passengers'] = null
  if (row.category === 'passenger') {
    const counts = await getDb()
      .select({ isInfant: tripPassengers.isInfant, value: count() })
      .from(tripPassengers)
      .where(eq(tripPassengers.manifestId, row.manifestId))
      .groupBy(tripPassengers.isInfant)
    passengers = {
      seated: counts.find((c) => !c.isInfant)?.value ?? 0,
      infants: counts.find((c) => c.isInfant)?.value ?? 0
    }
  }

  return {
    ok: true,
    data: {
      status: now <= row.validUntil ? 'valid' : 'expired',
      manifestNo: row.manifestNo,
      certificateNo: row.certificateNo,
      plateNumber: row.plateNumber,
      tripKind: row.tripKind,
      origin: { name: row.originName, nameAr: row.originNameAr },
      destination: { name: row.destinationName, nameAr: row.destinationNameAr },
      departureAt: row.departureAt.getTime(),
      arrivalAt: row.arrivalAt.getTime(),
      passengers,
      issuedAt: row.issuedAt.getTime(),
      validUntil: row.validUntil.getTime(),
      carrierName: row.carrierName ?? '',
      amountPaid: row.amountPaid,
      checkedAt: now.getTime()
    }
  }
}
