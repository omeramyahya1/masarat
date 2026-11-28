// The government dashboard from aggregates. Every night (01:00) the figures of each past day are
// computed once into dashboard_facts (schema.ts explains its rows), at the grain of the dashboard's
// filters. A dashboard then reads:
//   - the history: whole days before today, added up from dashboard_facts (and computed live for
//     any day the nightly job hasn't covered yet, so a failed night only costs speed)
//   - today: the same figures computed live for today alone, plus the present (active trips,
//     pending bills, the latest bills; dashboard.ts currentFigures)
// The portal adds the two together (mergeDashboard in @masarat/shared/dashboard), keeps the history
// until the next night and asks only for today when refreshed. Exact to the minute isn't needed:
// statuses and payments are as they were when their day was last aggregated.
//
// Each whole month's days are also added up into dashboard_facts_month, so a long range reads its
// whole months there (a row per month) and only its first and last days from dashboard_facts:
// a day holds about as many fact rows as trips, so twelve months of days were millions of rows.
import { sql, type SQL } from 'drizzle-orm'
import {
  formatDay,
  parseDay,
  type AnalyticsFilters,
  type DashboardView
} from '@masarat/shared/analytics'
import {
  PASSENGERS_SLICE,
  emptyPart,
  splitRange,
  type BreakdownRow,
  type CargoSlice,
  type DashboardHistory,
  type DashboardPart,
  type DashboardToday,
  type TaxSlice
} from '@masarat/shared/dashboard'
import { MANIFEST_STATUSES, type ManifestStatus } from '@masarat/shared/fleet'
import { getDb, type AppDatabase } from '../db'
import { log } from '../log'
import { currentFigures } from './dashboard'

type Executor = Pick<AppDatabase, 'execute'>

// Recent days are recomputed every night: their trips' statuses and payments still change
export const DASHBOARD_RECOMPUTE_DAYS = 35
// The local hour the nightly job works from
export const DASHBOARD_AGGREGATE_HOUR = 1

const THROUGH_KEY = 'dashboard.aggregated_through'
const ON_KEY = 'dashboard.aggregated_on'

// YYYYMMDD as stored in system_settings (an integer column)
const dayNumber = (day: string): number => Number(day.replaceAll('-', ''))
const dayFromNumber = (n: number): string => {
  const s = String(n)
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}
const addDays = (day: string, days: number): string => {
  const date = parseDay(day)!
  date.setDate(date.getDate() + days)
  return formatDay(date)
}
const ts = (day: string): SQL => sql`${day}::date::timestamptz`
// The first day of the day's month, and of the next month
const monthOf = (day: string): string => `${day.slice(0, 7)}-01`
const nextMonth = (day: string): string => {
  const date = parseDay(monthOf(day))!
  date.setMonth(date.getMonth() + 1)
  return formatDay(date)
}

// Every figure of [from, to) (local midnights), as rows shaped like dashboard_facts. Reads live and
// archived trips (the all_* views), or only the live tables for today: a trip paid, billed, booked
// or issued today is still live (the archive only takes trips finished over HOT_DAYS ago), and
// through the views Postgres has no statistics, so it misjudges the joins by thousands of times
// and reads whole tables. Days are Sudan days (the session's time zone).
function factsSelect(from: SQL, to: SQL, source: 'all' | 'live' = 'all'): SQL {
  const t = (name: string): SQL => sql.raw(source === 'all' ? `all_${name}` : name)
  const dims = sql.raw(
    'm.origin_city_id, m.destination_city_id, m.category, m.trip_kind, v.vehicle_type, m.cargo_type'
  )
  return sql`
    WITH paid AS (
      SELECT p.manifest_id, p.amount, p.paid_at::date AS day, ${dims}, m.company_id
      FROM ${t('payments')} p
      JOIN ${t('manifests')} m ON m.id = p.manifest_id
      JOIN vehicles v ON v.id = m.vehicle_id
      WHERE p.status = 'paid' AND p.paid_at >= ${from} AND p.paid_at < ${to}
    ),
    items AS (
      SELECT i.manifest_id, i.cargo_type, i.cost
      FROM ${t('manifest_cargo_items')} i JOIN paid ON paid.manifest_id = i.manifest_id
    ),
    item_cost AS (SELECT manifest_id, sum(cost) AS cost FROM items GROUP BY manifest_id),
    -- Each paid trip's taxes split across its items by their cost; a trip without items counts
    -- under its own cargo type, or as passengers (as dailyRevenue.ts cargoSharesSql does)
    shares AS (
      SELECT paid.*, items.cargo_type AS slice,
             paid.amount::float8 * items.cost / item_cost.cost AS revenue
      FROM paid
      JOIN items ON items.manifest_id = paid.manifest_id
      JOIN item_cost ON item_cost.manifest_id = paid.manifest_id
      WHERE item_cost.cost > 0
      UNION ALL
      SELECT paid.*, coalesce(paid.cargo_type, ${PASSENGERS_SLICE}), paid.amount::float8
      FROM paid LEFT JOIN item_cost ON item_cost.manifest_id = paid.manifest_id
      WHERE coalesce(item_cost.cost, 0) <= 0
    )
    SELECT day, 'paid' AS kind, origin_city_id, destination_city_id, category, trip_kind,
           vehicle_type, cargo_type, '' AS key, NULL::text AS name, NULL::text AS name_ar,
           sum(amount)::float8 AS value, count(*)::int AS n
    FROM paid GROUP BY 1, 3, 4, 5, 6, 7, 8
    UNION ALL
    SELECT day, 'cargo', origin_city_id, destination_city_id, category, trip_kind, vehicle_type,
           cargo_type, slice, NULL, NULL, sum(revenue), count(DISTINCT manifest_id)::int
    FROM shares GROUP BY 1, 3, 4, 5, 6, 7, 8, 9
    UNION ALL
    SELECT paid.day, 'charge', origin_city_id, destination_city_id, category, trip_kind,
           vehicle_type, cargo_type, c.code,
           (array_agg(c.name ORDER BY c.id DESC))[1], (array_agg(c.name_ar ORDER BY c.id DESC))[1],
           sum(c.amount)::float8, count(*)::int
    FROM paid JOIN ${t('manifest_charges')} c ON c.manifest_id = paid.manifest_id
    GROUP BY 1, 3, 4, 5, 6, 7, 8, 9
    UNION ALL
    SELECT day, 'company', NULL, NULL, category, trip_kind, vehicle_type, NULL,
           company_id::text, NULL, NULL, sum(amount)::float8, count(*)::int
    FROM paid GROUP BY 1, 5, 6, 7, 9
    UNION ALL
    SELECT m.created_at::date, 'status', ${dims}, m.status, NULL, NULL, 0, count(*)::int
    FROM ${t('manifests')} m JOIN vehicles v ON v.id = m.vehicle_id
    WHERE m.created_at >= ${from} AND m.created_at < ${to}
    GROUP BY 1, 3, 4, 5, 6, 7, 8, 9
    UNION ALL
    SELECT p.created_at::date, 'billed', ${dims}, '', NULL, NULL, sum(p.amount)::float8,
           count(*)::int
    FROM ${t('payments')} p JOIN ${t('manifests')} m ON m.id = p.manifest_id
    JOIN vehicles v ON v.id = m.vehicle_id
    WHERE p.created_at >= ${from} AND p.created_at < ${to}
    GROUP BY 1, 3, 4, 5, 6, 7, 8
    UNION ALL
    SELECT p.created_at::date, 'billed_paid', ${dims}, '', NULL, NULL, sum(p.amount)::float8,
           count(*)::int
    FROM ${t('payments')} p JOIN ${t('manifests')} m ON m.id = p.manifest_id
    JOIN vehicles v ON v.id = m.vehicle_id
    WHERE p.status = 'paid' AND p.created_at >= ${from} AND p.created_at < ${to}
    GROUP BY 1, 3, 4, 5, 6, 7, 8
    UNION ALL
    SELECT c.issued_at::date, 'certificates', ${dims}, '', NULL, NULL, 0, count(*)::int
    FROM ${t('certificates')} c JOIN ${t('manifests')} m ON m.id = c.manifest_id
    JOIN vehicles v ON v.id = m.vehicle_id
    WHERE c.issued_at >= ${from} AND c.issued_at < ${to}
    GROUP BY 1, 3, 4, 5, 6, 7, 8`
}

const FACT_COLUMNS = sql.raw(
  'day, kind, origin_city_id, destination_city_id, category, trip_kind, vehicle_type, cargo_type, ' +
    'key, name, name_ar, value, n'
)

// Recomputes the facts of the days [fromDay, toDay), a month per transaction, then the months
// they fall in that are over by toDay (the days before toDay are all stored)
export async function rebuildFacts(fromDay: string, toDay: string): Promise<void> {
  for (let start = fromDay; start < toDay;) {
    const end = addDays(start, 31) < toDay ? addDays(start, 31) : toDay
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL statement_timeout = 0`)
      await tx.execute(sql`DELETE FROM dashboard_facts WHERE day >= ${start} AND day < ${end}`)
      await tx.execute(
        sql`INSERT INTO dashboard_facts (${FACT_COLUMNS}) ${factsSelect(ts(start), ts(end))}`
      )
    })
    start = end
  }
  for (let month = monthOf(fromDay); nextMonth(month) <= toDay; month = nextMonth(month)) {
    await rebuildMonth(month)
  }
}

// Adds up one month's stored days into dashboard_facts_month
async function rebuildMonth(month: string): Promise<void> {
  await getDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = 0`)
    await tx.execute(sql`DELETE FROM dashboard_facts_month WHERE day = ${month}`)
    // A charge's name is its latest one in the month
    await tx.execute(sql`
      INSERT INTO dashboard_facts_month (${FACT_COLUMNS})
      SELECT ${month}::date, kind, origin_city_id, destination_city_id, category, trip_kind,
             vehicle_type, cargo_type, key,
             (array_agg(name ORDER BY day DESC))[1], (array_agg(name_ar ORDER BY day DESC))[1],
             sum(value), sum(n)
      FROM dashboard_facts WHERE day >= ${month} AND day < ${nextMonth(month)}
      GROUP BY kind, origin_city_id, destination_city_id, category, trip_kind, vehicle_type,
               cargo_type, key`)
  })
}

// The months over by toDay, since the first trip, that have no monthly rows yet (the daily facts
// stored before the monthly ones existed, or a month without a single fact)
async function fillMissingMonths(toDay: string): Promise<number> {
  const first = await firstDay()
  if (!first) return 0
  const stored = new Set(
    (
      await getDb().execute<{ day: string }>(
        sql`SELECT DISTINCT day::text AS day FROM dashboard_facts_month`
      )
    ).map((r) => r.day)
  )
  let filled = 0
  for (let month = monthOf(first); nextMonth(month) <= toDay; month = nextMonth(month)) {
    if (stored.has(month)) continue
    await rebuildMonth(month)
    filled++
  }
  return filled
}

async function setMarker(db: Executor, key: string, value: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO system_settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`)
}

async function marker(key: string): Promise<number | null> {
  const [row] = await getDb().execute<{ value: number }>(
    sql`SELECT value FROM system_settings WHERE key = ${key}`
  )
  return row ? Number(row.value) : null
}

// The last day the aggregates cover, or null
export async function aggregatedThrough(): Promise<string | null> {
  const n = await marker(THROUGH_KEY)
  return n ? dayFromNumber(n) : null
}

// The first day with any trip or payment, as YYYY-MM-DD (null on an empty database)
async function firstDay(): Promise<string | null> {
  const [row] = await getDb().execute<{ day: string | null }>(sql`
    SELECT least((SELECT min(created_at) FROM all_manifests),
                 (SELECT min(paid_at) FROM all_payments))::date::text AS day`)
  return row?.day ?? null
}

// Brings the aggregates up to yesterday: the days not covered yet, and the last
// DASHBOARD_RECOMPUTE_DAYS again. Returns the days recomputed.
export async function aggregateDashboard(now = new Date()): Promise<number> {
  const today = formatDay(now)
  const through = await aggregatedThrough()
  const recentFrom = addDays(today, -DASHBOARD_RECOMPUTE_DAYS)
  let from: string | null = through ? addDays(through, 1) : await firstDay()
  if (from === null) from = today
  if (recentFrom < from) from = recentFrom
  const started = performance.now()
  await rebuildFacts(from, today)
  const months = await fillMissingMonths(today)
  await setMarker(getDb(), THROUGH_KEY, dayNumber(addDays(today, -1)))
  await setMarker(getDb(), ON_KEY, dayNumber(today))
  const days = Math.round((parseDay(today)!.getTime() - parseDay(from)!.getTime()) / 86_400_000)
  log.info('Dashboard aggregates rebuilt', {
    from,
    to: today,
    days,
    missingMonths: months,
    ms: Math.round(performance.now() - started)
  })
  return days
}

// The hourly job: once a day, from 01:00
export async function nightlyDashboardAggregate(now = new Date()): Promise<number> {
  if (now.getHours() < DASHBOARD_AGGREGATE_HOUR) return 0
  if ((await marker(ON_KEY)) === dayNumber(formatDay(now))) return 0
  return aggregateDashboard(now)
}

// After bulk changes (regenerating the demo data, seeding): everything is computed again
export async function resetDashboardFacts(): Promise<void> {
  await getDb().execute(sql`DELETE FROM dashboard_facts`)
  await getDb().execute(sql`DELETE FROM dashboard_facts_month`)
  await getDb().execute(sql`DELETE FROM system_settings WHERE key IN (${THROUGH_KEY}, ${ON_KEY})`)
}

// --- Reading ------------------------------------------------------------------------------------

// The filters as conditions on fact rows (f). The company rows have no route or cargo, so a route
// or cargo filter leaves them out (the portal doesn't offer the company breakdown then).
function factFilters(f: AnalyticsFilters): SQL {
  const conditions: SQL[] = [sql`true`]
  const inState = (column: SQL, state: string): SQL =>
    sql`${column} IN (SELECT c.id FROM cities c JOIN states s ON s.id = c.state_id WHERE s.name = ${state})`
  if (f.originCityId) conditions.push(sql`f.origin_city_id = ${f.originCityId}`)
  if (f.destinationCityId) conditions.push(sql`f.destination_city_id = ${f.destinationCityId}`)
  if (f.originState) conditions.push(inState(sql`f.origin_city_id`, f.originState))
  if (f.destinationState) conditions.push(inState(sql`f.destination_city_id`, f.destinationState))
  if (f.category) conditions.push(sql`f.category = ${f.category}`)
  if (f.cargoType) conditions.push(sql`f.cargo_type = ${f.cargoType}`)
  if (f.vehicleType) conditions.push(sql`f.vehicle_type = ${f.vehicleType}`)
  if (f.tripKind) conditions.push(sql`f.trip_kind = ${f.tripKind}`)
  return sql.join(conditions, sql` AND `)
}

// The fact rows of [fromDay, toDay): the days the aggregates cover from dashboard_facts, any later
// ones computed live (normally none: the nightly job covers up to yesterday). With `months`, the
// whole months among the stored days come from dashboard_facts_month (a row per month, its day
// the month's first): for every figure but the revenue by day.
function factSource(
  fromDay: string,
  toDay: string,
  through: string | null,
  { months = false } = {}
): SQL {
  const coveredTo = through ? addDays(through, 1) : fromDay
  const storedTo = coveredTo < toDay ? coveredTo : toDay
  const liveFrom = storedTo > fromDay ? storedTo : fromDay
  const parts: SQL[] = []
  const days = (from: string, to: string): void => {
    if (to > from) {
      parts.push(sql`SELECT ${FACT_COLUMNS} FROM dashboard_facts
        WHERE day >= ${from} AND day < ${to}`)
    }
  }
  // The whole months inside [fromDay, storedTo)
  const monthsFrom = fromDay === monthOf(fromDay) ? fromDay : nextMonth(fromDay)
  const monthsTo = monthOf(storedTo)
  if (months && monthsFrom < monthsTo) {
    days(fromDay, monthsFrom)
    parts.push(sql`SELECT ${FACT_COLUMNS} FROM dashboard_facts_month
      WHERE day >= ${monthsFrom} AND day < ${monthsTo}`)
    days(monthsTo, storedTo)
  } else {
    days(fromDay, storedTo)
  }
  if (liveFrom < toDay) {
    parts.push(sql`SELECT ${FACT_COLUMNS} FROM (${factsSelect(ts(liveFrom), ts(toDay))}) live`)
  }
  if (parts.length === 0) parts.push(sql`SELECT ${FACT_COLUMNS} FROM dashboard_facts WHERE false`)
  return sql`(${sql.join(parts, sql` UNION ALL `)}) f`
}

async function summarize(
  // The rows to add up, and the same by day (for the revenue by day; may be the same rows)
  { source, daily }: { source: SQL; daily: SQL },
  filters: AnalyticsFilters,
  view: DashboardView,
  from: number,
  to: number
): Promise<DashboardPart> {
  const db = getDb()
  const where = factFilters(filters)
  const rows = <T>(query: SQL): Promise<T[]> =>
    db.execute<Record<string, unknown>>(query) as unknown as Promise<T[]>

  const breakdownQuery = (): Promise<BreakdownRow[]> => {
    const grouped = (key: SQL, kind = 'paid', join: SQL = sql``): Promise<BreakdownRow[]> =>
      rows<{ key: string; revenue: number; trips: number }>(sql`
        SELECT ${key} AS key, sum(f.value)::float8 AS revenue, sum(f.n)::int AS trips
        FROM ${source} ${join}
        WHERE f.kind = ${kind} AND ${where} GROUP BY 1`).then((r) =>
        r.filter((x) => x.key !== null).map((x) => ({ ...x, revenue: Number(x.revenue) }))
      )
    switch (view.breakdown) {
      case 'route':
        return grouped(sql`f.origin_city_id || '-' || f.destination_city_id`).then((r) =>
          r.map((row) => {
            const [o, d] = row.key.split('-').map(Number)
            return { ...row, originCityId: o, destinationCityId: d }
          })
        )
      case 'originState':
        return grouped(
          sql`s.name`,
          'paid',
          sql`JOIN cities c ON c.id = f.origin_city_id JOIN states s ON s.id = c.state_id`
        )
      case 'destinationState':
        return grouped(
          sql`s.name`,
          'paid',
          sql`JOIN cities c ON c.id = f.destination_city_id JOIN states s ON s.id = c.state_id`
        )
      case 'category':
        return grouped(sql`f.category`)
      case 'vehicleType':
        return grouped(sql`f.vehicle_type`)
      case 'tripKind':
        return grouped(sql`f.trip_kind`)
      case 'cargoType':
        return grouped(sql`f.key`, 'cargo')
      case 'company':
        return rows<{ key: string; name: string; revenue: number; trips: number }>(sql`
          SELECT f.key, co.name, sum(f.value)::float8 AS revenue, sum(f.n)::int AS trips
          FROM ${source} JOIN companies co ON co.id = f.key::int
          WHERE f.kind = 'company' AND ${where} GROUP BY f.key, co.name`).then((r) =>
          r.map((x) => ({ ...x, revenue: Number(x.revenue) }))
        )
    }
  }

  const [totals, byDay, cargo, taxes, statuses, breakdown] = await Promise.all([
    rows<{ kind: string; value: number; n: number }>(sql`
      SELECT f.kind, sum(f.value)::float8 AS value, sum(f.n)::int AS n FROM ${source}
      WHERE f.kind IN ('paid', 'certificates', 'billed', 'billed_paid') AND ${where}
      GROUP BY f.kind`),
    rows<{ day: string; revenue: number; trips: number }>(sql`
      SELECT f.day::text AS day, sum(f.value)::float8 AS revenue, sum(f.n)::int AS trips
      FROM ${daily} WHERE f.kind = 'paid' AND ${where} GROUP BY 1 ORDER BY 1`),
    rows<{ key: string; revenue: number; trips: number }>(sql`
      SELECT f.key, sum(f.value)::float8 AS revenue, sum(f.n)::int AS trips FROM ${source}
      WHERE f.kind = 'cargo' AND ${where} GROUP BY f.key`),
    // By code and name (a charge renamed has a row per name), with the latest day of each name:
    // the latest one names the charge (latestNames). Hashed, not sorted: millions of rows.
    rows<{ key: string; name: string; name_ar: string; revenue: number; last: string }>(sql`
      SELECT f.key, f.name, f.name_ar, sum(f.value)::float8 AS revenue, max(f.day)::text AS last
      FROM ${source} WHERE f.kind = 'charge' AND ${where} GROUP BY f.key, f.name, f.name_ar`).then(
      latestNames
    ),
    rows<{ key: string; n: number }>(sql`
      SELECT f.key, sum(f.n)::int AS n FROM ${source}
      WHERE f.kind = 'status' AND ${where} GROUP BY f.key`),
    breakdownQuery()
  ])

  const part = emptyPart(from, to)
  const total = (kind: string): { value: number; n: number } => {
    const row = totals.find((t) => t.kind === kind)
    return { value: Number(row?.value ?? 0), n: Number(row?.n ?? 0) }
  }
  part.revenue = total('paid').value
  part.paidTrips = total('paid').n
  part.certificatesIssued = total('certificates').n
  part.billedAmount = total('billed').value
  part.billedPaidAmount = total('billed_paid').value
  part.revenueByDay = byDay.map((d) => ({
    day: d.day,
    revenue: Number(d.revenue),
    trips: Number(d.trips)
  }))
  part.byCargo = cargo.map((c) => ({
    cargoType: c.key as CargoSlice['cargoType'],
    revenue: Number(c.revenue),
    trips: Number(c.trips)
  }))
  part.byTax = taxes.map((t): TaxSlice => ({
    code: t.key,
    name: t.name,
    nameAr: t.name_ar,
    revenue: Number(t.revenue)
  }))
  for (const s of statuses) {
    if ((MANIFEST_STATUSES as readonly string[]).includes(s.key)) {
      part.statusCounts[s.key as ManifestStatus] = Number(s.n)
    }
  }
  part.breakdown = breakdown
  return part
}

// One row per charge: its revenue under every name, and the name of its latest day
function latestNames<T extends { key: string; revenue: number; last: string }>(rows: T[]): T[] {
  const byKey = new Map<string, T>()
  for (const row of rows) {
    const seen = byKey.get(row.key)
    const revenue = Number(row.revenue) + Number(seen?.revenue ?? 0)
    const latest = !seen || row.last > seen.last ? row : seen
    byKey.set(row.key, { ...latest, revenue })
  }
  return [...byKey.values()]
}

// Whole days of the range before today, and the period of the same length before it
export async function dashboardHistory(
  filters: AnalyticsFilters,
  view: DashboardView,
  now = new Date()
): Promise<DashboardHistory> {
  const { from, to, historyTo } = splitRange(filters, now)
  const through = await aggregatedThrough()
  const fromDay = formatDay(from)
  const toDay = formatDay(historyTo)
  const part =
    fromDay < toDay
      ? await summarize(
          {
            source: factSource(fromDay, toDay, through, { months: true }),
            daily: factSource(fromDay, toDay, through)
          },
          filters,
          view,
          +from,
          +historyTo
        )
      : emptyPart(+from, +historyTo)

  // The previous period: as long as the range, ending where it starts, if the records reach back
  const length = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000))
  const previousFrom = addDays(fromDay, -length)
  const first = await firstDay()
  let previousRevenue: number | null = null
  if (first && first <= previousFrom) {
    const [row] = await getDb().execute<{ value: number | null }>(sql`
      SELECT sum(f.value)::float8 AS value
      FROM ${factSource(previousFrom, fromDay, through, { months: true })}
      WHERE f.kind = 'paid' AND ${factFilters(filters)}`)
    previousRevenue = Number(row?.value ?? 0)
  }
  return { part, previousRevenue, aggregatedThrough: through }
}

// Today (when the range reaches it), live, with the present
export async function dashboardToday(
  filters: AnalyticsFilters,
  view: DashboardView,
  now = new Date()
): Promise<DashboardToday> {
  const { from, to, today, hasToday } = splitRange(filters, now)
  const start = today > from ? today : from
  const todayDay = formatDay(start)
  // Nothing stored for today: all of it live, up to now
  const live = sql`(SELECT ${FACT_COLUMNS} FROM (${factsSelect(ts(todayDay), sql`${to.toISOString()}::timestamptz`, 'live')}) live) f`
  const part = hasToday
    ? await summarize({ source: live, daily: live }, filters, view, +start, +to)
    : emptyPart(+start, +to)
  return { part, now: await currentFigures(filters, from, to, now) }
}
