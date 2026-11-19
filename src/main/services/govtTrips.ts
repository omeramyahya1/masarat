// The government's trip search: by E-Sali bill ID, receipt or manifest number, trip number,
// plate, company or city name, and by route
import { and, desc, eq, like, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { certificates, cities, getDb, manifests, payments, users, vehicles } from '../db'
import {
  MAX_SEARCH_RESULTS,
  type GovtSearchInput,
  type GovtSearchResult
} from '../../shared/billing'
import type { FleetResult } from '../../shared/fleet'
import { plateSearchKey } from '../../shared/plate'

const origin = alias(cities, 'search_origin')
const destination = alias(cities, 'search_destination')

// LIKE with the user's text taken literally
const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`)
const contains = (column: Parameters<typeof like>[0], text: string): SQL =>
  sql`${column} LIKE ${`%${escapeLike(text)}%`} ESCAPE '\\'`

// What the text can mean, most specific first
function textConditions(raw: string): SQL | undefined {
  const text = raw.trim()
  if (!text) return undefined
  const western = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))

  // An E-Sali bill ID (22 digits) or the start of one
  if (/^\d{6,22}$/.test(western)) {
    return sql`${payments.billId} LIKE ${`${western}%`}`
  }
  // A trip number: "123" or "#123"
  const tripNo = /^#?(\d{1,5})$/.exec(western)
  if (tripNo) return eq(manifests.id, Number(tripNo[1]))
  // A receipt or manifest number, whole or in part (MNF-2026-000123, mnf 2026 123, …)
  const docNo = /^(MNF|MSR)[\s-]*(\d{4})?[\s-]*(\d{0,6})$/i.exec(western)
  if (docNo) {
    const [, prefix, year, digits] = docNo
    const column =
      prefix.toUpperCase() === 'MNF' ? certificates.manifestNo : certificates.certificateNo
    if (year && digits) {
      return eq(column, `${prefix.toUpperCase()}-${year}-${digits.padStart(6, '0')}`)
    }
    return sql`${column} LIKE ${`${prefix.toUpperCase()}-${year ?? ''}%`}`
  }

  const plate = plateSearchKey(text)
  return or(
    plate.length >= 2
      ? sql`replace(replace(upper(${vehicles.plateNumber}), ' ', ''), '/', '') LIKE ${`%${escapeLike(plate)}%`} ESCAPE '\\'`
      : undefined,
    contains(vehicles.registrationNo, text),
    contains(users.companyName, text),
    contains(users.fullName, text),
    contains(origin.name, text),
    contains(origin.nameAr, text),
    contains(destination.name, text),
    contains(destination.nameAr, text),
    contains(manifests.shipperName, text),
    contains(manifests.receiverName, text),
    contains(manifests.driverName, text)
  )
}

export function searchTrips(input: GovtSearchInput): FleetResult<GovtSearchResult[]> {
  const query = typeof input?.query === 'string' ? input.query.slice(0, 80) : ''
  const originCityId = typeof input?.originCityId === 'number' ? input.originCityId : null
  const destinationCityId =
    typeof input?.destinationCityId === 'number' ? input.destinationCityId : null
  const text = textConditions(query)
  if (!text && originCityId === null && destinationCityId === null) {
    return { ok: false, error: 'missing_fields' }
  }

  const rows = getDb()
    .select({
      manifestId: manifests.id,
      manifestNo: certificates.manifestNo,
      billId: payments.billId,
      companyName: users.companyName,
      fullName: users.fullName,
      plateNumber: vehicles.plateNumber,
      originCityId: manifests.originCityId,
      destinationCityId: manifests.destinationCityId,
      tripDate: manifests.tripDate,
      amount: manifests.taxAmount,
      status: manifests.status
    })
    .from(manifests)
    .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
    .innerJoin(users, eq(vehicles.ownerId, users.id))
    .innerJoin(origin, eq(manifests.originCityId, origin.id))
    .innerJoin(destination, eq(manifests.destinationCityId, destination.id))
    .leftJoin(payments, eq(payments.manifestId, manifests.id))
    .leftJoin(certificates, eq(certificates.manifestId, manifests.id))
    .where(
      and(
        text,
        originCityId === null ? undefined : eq(manifests.originCityId, originCityId),
        destinationCityId === null ? undefined : eq(manifests.destinationCityId, destinationCityId)
      )
    )
    .orderBy(desc(manifests.tripDate), desc(manifests.id))
    .limit(MAX_SEARCH_RESULTS)
    .all()

  return {
    ok: true,
    data: rows.map(({ companyName, fullName, tripDate, ...row }) => ({
      ...row,
      companyName: companyName || fullName,
      tripDate: tripDate.getTime()
    }))
  }
}
