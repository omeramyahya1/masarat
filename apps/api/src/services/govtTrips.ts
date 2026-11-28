// The government's trip search: by E-Sali bill ID, receipt or manifest number, trip number,
// plate, company or city name, and by route
import { and, desc, eq, inArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
import { cities, companies, getDb, people, tripViews, vehicles } from '../db'
import type { GovtSearchInput, GovtSearchResult } from '@masarat/shared/billing'
import { DEFAULT_PAGE_SIZE, isPageSize, type Page } from '@masarat/shared/paging'
import type { FleetResult } from '@masarat/shared/fleet'
import { idSearchKey } from '@masarat/shared/passengers'
import { plateSearchKey } from '@masarat/shared/plate'
import { contains, escapeLike, plateKeyOf } from './sqlText'

// Reads live and archived trips alike (the all_* views)
const { certificates, manifests, payments, tripPassengers } = tripViews

// A government search can match a large share of all trips ("Khartoum", a common name), and
// counting them exactly takes seconds: the count stops past this many, and the pages reach it
export const SEARCH_CAP = 1_000

// "This column is one of the ids the subquery finds", written so the subquery runs once and the
// column is looked up through its index (a join or EXISTS would read every trip)
const anyOf = (column: SQLWrapper, subquery: SQLWrapper): SQL =>
  sql`${column} = ANY(ARRAY(${subquery}))`

// What the text can mean, most specific first, as conditions on manifests alone: a trip matches
// when it meets any of them. Each is searched on its own (searchTrips): together in one OR,
// Postgres can't tell how many trips each finds, and walked every trip newest first (2-3 s for a
// plate with a few trips).
function textConditions(raw: string): SQL[] | undefined {
  const text = raw.trim()
  if (!text) return undefined
  const western = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
  const db = getDb()

  // Plates match whatever else the text could be, so "34567" or "12/34567" (Western or Arabic
  // digits) finds plates too (vehicles_plate_key_trgm_idx)
  const plateKey = plateSearchKey(text)
  const plate =
    plateKey.length >= 2
      ? anyOf(
          manifests.vehicleId,
          db
            .select({ id: vehicles.id })
            .from(vehicles)
            .where(
              sql`${plateKeyOf(vehicles.plateNumber)} LIKE ${`%${escapeLike(plateKey)}%`} ESCAPE '\\'`
            )
        )
      : undefined

  // A passenger's national ID or passport number, exactly: the person (one lookup in the
  // registry's index), then their trips
  const idKey = idSearchKey(text)
  const passenger = idKey
    ? anyOf(
        manifests.id,
        db
          .select({ id: tripPassengers.manifestId })
          .from(tripPassengers)
          .where(
            anyOf(
              tripPassengers.personId,
              db.select({ id: people.id }).from(people).where(eq(people.idNumber, idKey))
            )
          )
      )
    : undefined

  // "#123": only a trip number, whatever its length (the ids run past 5 digits)
  const hashNo = /^#(\d{1,9})$/.exec(western)
  if (hashNo) return [eq(manifests.id, Number(hashNo[1]))]
  // An E-Sali bill ID (22 digits) or the start of one, or a national ID (11 digits)
  if (/^\d{6,22}$/.test(western)) {
    return present(
      anyOf(
        manifests.id,
        db
          .select({ id: payments.manifestId })
          .from(payments)
          .where(sql`${payments.billId} LIKE ${`${western}%`}`)
      ),
      plate,
      passenger
    )
  }
  // A short number: a trip number, or part of a plate
  const tripNo = /^\d{1,5}$/.exec(western)
  if (tripNo) return present(eq(manifests.id, Number(tripNo[0])), plate)
  // A receipt or manifest number, whole or in part (MNF-2026-000123, psg 2026 123, …), through
  // the numbers' prefix indexes
  const docNo = /^(MNF|PSG|MSR)[\s-]*(\d{4})?[\s-]*(\d{0,6})$/i.exec(western)
  if (docNo) {
    const [, prefix, year, digits] = docNo
    const column =
      prefix.toUpperCase() === 'MSR' ? certificates.certificateNo : certificates.manifestNo
    const match =
      year && digits
        ? eq(column, `${prefix.toUpperCase()}-${year}-${digits.padStart(6, '0')}`)
        : sql`${column} LIKE ${`${prefix.toUpperCase()}-${year ?? ''}%`}`
    return [
      anyOf(
        manifests.id,
        db.select({ id: certificates.manifestId }).from(certificates).where(match)
      )
    ]
  }

  // Names: the vehicle's registration, the company, the cities (small tables, matched first), and
  // the sender, receiver and driver on the trip (trigram indexes)
  const matchingCities = db
    .select({ id: cities.id })
    .from(cities)
    .where(or(contains(cities.name, text), contains(cities.nameAr, text)))
  return present(
    plate,
    passenger,
    anyOf(
      manifests.vehicleId,
      db.select({ id: vehicles.id }).from(vehicles).where(contains(vehicles.registrationNo, text))
    ),
    anyOf(
      manifests.companyId,
      db.select({ id: companies.id }).from(companies).where(contains(companies.name, text))
    ),
    anyOf(manifests.originCityId, matchingCities),
    anyOf(manifests.destinationCityId, matchingCities),
    contains(manifests.shipperName, text),
    contains(manifests.receiverName, text),
    contains(manifests.driverName, text)
  )
}

const present = (...conditions: (SQL | undefined)[]): SQL[] =>
  conditions.filter((c): c is SQL => c !== undefined)

// One page of the matches, newest first. The count stops past SEARCH_CAP (`more` says so), and the
// pages go no further than that.
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

  const route = and(
    originCityId === null ? undefined : eq(manifests.originCityId, originCityId),
    destinationCityId === null ? undefined : eq(manifests.destinationCityId, destinationCityId)
  )
  const pageSize = isPageSize(input?.pageSize) ? input.pageSize : DEFAULT_PAGE_SIZE
  const requested =
    Number.isInteger(input?.page) && (input.page as number) > 0 ? (input.page as number) : 1

  // Each condition's newest SEARCH_CAP + 1 trips, each through its own index; together (UNION
  // drops a trip several of them find) they hold the newest SEARCH_CAP + 1 matches of all, and
  // their number is exact up to the cap (past it, only "more" is known). The page's trips are cut
  // from them, from the trips alone; their bills and documents follow. Joined through the live +
  // archive views before the page is cut, Postgres misjudges the joins (it has no statistics for
  // the views) and may read every payment and certificate.
  const branches = (text ?? [undefined]).map(
    (condition) => sql`(SELECT ${manifests.id} AS id, ${manifests.departureAt} AS departure_at
      FROM ${manifests} WHERE ${and(condition, route) ?? sql`true`}
      ORDER BY ${manifests.departureAt} DESC, ${manifests.id} DESC LIMIT ${SEARCH_CAP + 1})`
  )
  const db = getDb()
  const pageOf = (n: number): Promise<{ id: number; found: number }[]> =>
    db.execute<{ id: number; found: number }>(sql`
      WITH hits AS (${sql.join(branches, sql` UNION `)})
      SELECT id, count(*) OVER ()::int AS found FROM hits
      ORDER BY departure_at DESC, id DESC
      LIMIT ${pageSize} OFFSET ${(n - 1) * pageSize}`)
  // Pages stop at the cap, so no page reaches past the newest SEARCH_CAP matches
  let page = Math.min(requested, Math.ceil(SEARCH_CAP / pageSize))
  let hits = await pageOf(page)
  let found = hits[0]?.found ?? 0
  if (hits.length === 0 && page > 1) {
    // Past the last page: the last one instead
    const [all] = await db.execute<{ found: number }>(sql`
      SELECT count(*)::int AS found FROM (${sql.join(branches, sql` UNION `)}) hits`)
    found = all?.found ?? 0
    page = Math.max(1, Math.ceil(Math.min(found, SEARCH_CAP) / pageSize))
    hits = await pageOf(page)
  }
  const more = found > SEARCH_CAP
  const total = Math.min(found, SEARCH_CAP)
  const ids = hits.map((r) => Number(r.id))
  const rows =
    ids.length === 0
      ? []
      : await db
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
          .innerJoin(companies, eq(manifests.companyId, companies.id))
          .leftJoin(payments, eq(payments.manifestId, manifests.id))
          .leftJoin(certificates, eq(certificates.manifestId, manifests.id))
          .where(inArray(manifests.id, ids))
          .orderBy(desc(manifests.departureAt), desc(manifests.id))

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
      pageSize,
      more
    }
  }
}
