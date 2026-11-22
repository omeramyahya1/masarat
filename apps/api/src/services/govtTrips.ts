// The government's trip search: by E-Sali bill ID, receipt or manifest number, trip number,
// plate, company or city name, and by route
import { and, count, desc, eq, exists, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  certificates,
  cities,
  companies,
  getDb,
  manifests,
  payments,
  tripPassengers,
  vehicles
} from '../db'
import type { GovtSearchInput, GovtSearchResult } from '@masarat/shared/billing'
import { DEFAULT_PAGE_SIZE, isPageSize, type Page } from '@masarat/shared/paging'
import type { FleetResult } from '@masarat/shared/fleet'
import { idSearchKey } from '@masarat/shared/passengers'
import { plateSearchKey } from '@masarat/shared/plate'
import { contains, escapeLike, plateKeyOf } from './sqlText'

const origin = alias(cities, 'search_origin')
const destination = alias(cities, 'search_destination')

// What the text can mean, most specific first
function textConditions(raw: string): SQL | undefined {
  const text = raw.trim()
  if (!text) return undefined
  const western = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))

  // Plates match whatever else the text could be, so "34567" or "12/34567" (Western or Arabic
  // digits) finds plates too
  const plateKey = plateSearchKey(text)
  const plate =
    plateKey.length >= 2
      ? sql`${plateKeyOf(vehicles.plateNumber)} LIKE ${`%${escapeLike(plateKey)}%`} ESCAPE '\\'`
      : undefined

  // A passenger's national ID or passport number, exactly: one lookup in its index
  const idKey = idSearchKey(text)
  const passenger = idKey
    ? exists(
        getDb()
          .select({ id: tripPassengers.id })
          .from(tripPassengers)
          .where(
            and(eq(tripPassengers.manifestId, manifests.id), eq(tripPassengers.idNumber, idKey))
          )
      )
    : undefined

  // An E-Sali bill ID (22 digits) or the start of one, or a national ID (11 digits)
  if (/^\d{6,22}$/.test(western)) {
    return or(sql`${payments.billId} LIKE ${`${western}%`}`, plate, passenger)
  }
  // A trip number: "123" or "#123"
  const tripNo = /^(#)?(\d{1,5})$/.exec(western)
  if (tripNo) {
    // "#123" is only a trip number
    return tripNo[1]
      ? eq(manifests.id, Number(tripNo[2]))
      : or(eq(manifests.id, Number(tripNo[2])), plate)
  }
  // A receipt or manifest number, whole or in part (MNF-2026-000123, psg 2026 123, …)
  const docNo = /^(MNF|PSG|MSR)[\s-]*(\d{4})?[\s-]*(\d{0,6})$/i.exec(western)
  if (docNo) {
    const [, prefix, year, digits] = docNo
    const column =
      prefix.toUpperCase() === 'MSR' ? certificates.certificateNo : certificates.manifestNo
    if (year && digits) {
      return eq(column, `${prefix.toUpperCase()}-${year}-${digits.padStart(6, '0')}`)
    }
    return sql`${column} LIKE ${`${prefix.toUpperCase()}-${year ?? ''}%`}`
  }

  return or(
    plate,
    passenger,
    contains(vehicles.registrationNo, text),
    contains(companies.name, text),
    contains(origin.name, text),
    contains(origin.nameAr, text),
    contains(destination.name, text),
    contains(destination.nameAr, text),
    contains(manifests.shipperName, text),
    contains(manifests.receiverName, text),
    contains(manifests.driverName, text)
  )
}

// One page of the matches, newest first, with how many there are in all
export async function searchTrips(
  input: GovtSearchInput
): Promise<FleetResult<Page<GovtSearchResult>>> {
  const query = typeof input?.query === 'string' ? input.query.slice(0, 80) : ''
  const originCityId = typeof input?.originCityId === 'number' ? input.originCityId : null
  const destinationCityId =
    typeof input?.destinationCityId === 'number' ? input.destinationCityId : null
  const text = textConditions(query)
  if (!text && originCityId === null && destinationCityId === null) {
    return { ok: false, error: 'missing_fields' }
  }

  const where = and(
    text,
    originCityId === null ? undefined : eq(manifests.originCityId, originCityId),
    destinationCityId === null ? undefined : eq(manifests.destinationCityId, destinationCityId)
  )
  const db = getDb()
  const [{ total }] = await db
    .select({ total: count() })
    .from(manifests)
    .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
    .innerJoin(companies, eq(vehicles.companyId, companies.id))
    .innerJoin(origin, eq(manifests.originCityId, origin.id))
    .innerJoin(destination, eq(manifests.destinationCityId, destination.id))
    .leftJoin(payments, eq(payments.manifestId, manifests.id))
    .leftJoin(certificates, eq(certificates.manifestId, manifests.id))
    .where(where)
  const pageSize = isPageSize(input?.pageSize) ? input.pageSize : DEFAULT_PAGE_SIZE
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const requested =
    Number.isInteger(input?.page) && (input.page as number) > 0 ? (input.page as number) : 1
  const page = Math.min(requested, pages)

  const rows = await db
    .select({
      manifestId: manifests.id,
      manifestNo: certificates.manifestNo,
      billId: payments.billId,
      companyName: companies.name,
      plateNumber: vehicles.plateNumber,
      originCityId: manifests.originCityId,
      destinationCityId: manifests.destinationCityId,
      departureAt: manifests.departureAt,
      amount: manifests.taxAmount,
      status: manifests.status
    })
    .from(manifests)
    .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
    .innerJoin(companies, eq(vehicles.companyId, companies.id))
    .innerJoin(origin, eq(manifests.originCityId, origin.id))
    .innerJoin(destination, eq(manifests.destinationCityId, destination.id))
    .leftJoin(payments, eq(payments.manifestId, manifests.id))
    .leftJoin(certificates, eq(certificates.manifestId, manifests.id))
    .where(where)
    .orderBy(desc(manifests.departureAt), desc(manifests.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)

  return {
    ok: true,
    data: {
      rows: rows.map(({ departureAt, ...row }) => ({
        ...row,
        departureAt: departureAt.getTime()
      })),
      total,
      // The search has no unfiltered list behind it
      overall: total,
      page,
      pageSize
    }
  }
}
