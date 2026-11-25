// The dashboard's daily revenue summary (daily_revenue): what paid trips brought in, per Sudan day
// and per dimension (total, category, cargo slice, charge, route, origin and destination state,
// company, vehicle type, trip kind). The dashboard reads it for unfiltered views, so a 12-month
// view adds up a few thousand rows instead of every paid trip.
//
// It's kept exact: recording a payment as paid adds that trip's rows in the same transaction
// (addPaidTrip), and bulk writers (demo seeding, the load-test seeder) rebuild it afterwards
// (rebuildDailyRevenue). Migration 0006 filled it from the history with the same SQL.
import { eq, sql, type SQL } from 'drizzle-orm'
import { getDb, systemSettings, type AppDatabase } from '../db'
import { PASSENGERS_SLICE } from '@masarat/shared/dashboard'

type Executor = Pick<AppDatabase, 'execute'>

// After a `paid` CTE (manifest_id, amount, day, cargo_type): each paid trip's taxes split across
// its cargo items in proportion to their cost, as `cargo_shares` (day, key, revenue, manifest_id).
// A trip without items (passengers, or from before items existed) counts under its own cargo type,
// or as passengers. The dashboard's live query and the summary both use it, so they agree.
export const cargoSharesSql = sql`
items AS (
  SELECT i.manifest_id, i.cargo_type, i.cost
  FROM manifest_cargo_items i JOIN paid ON paid.manifest_id = i.manifest_id
),
item_cost AS (
  SELECT manifest_id, sum(cost) AS cost FROM items GROUP BY manifest_id
),
cargo_shares AS (
  SELECT paid.day, items.cargo_type AS key,
         paid.amount::float8 * items.cost / item_cost.cost AS revenue, paid.manifest_id
  FROM paid
  JOIN items ON items.manifest_id = paid.manifest_id
  JOIN item_cost ON item_cost.manifest_id = paid.manifest_id
  WHERE item_cost.cost > 0
  UNION ALL
  SELECT paid.day, coalesce(paid.cargo_type, ${PASSENGERS_SLICE}), paid.amount::float8, paid.manifest_id
  FROM paid LEFT JOIN item_cost ON item_cost.manifest_id = paid.manifest_id
  WHERE coalesce(item_cost.cost, 0) <= 0
)`

// One statement: the rows for the paid payments matching `where` (on payments as p), added to
// what's there. Days are Sudan days (the session's time zone).
export const summarySql = (where: SQL): SQL => sql`
WITH paid AS (
  SELECT p.manifest_id, p.amount, p.paid_at::date AS day, m.category, m.cargo_type,
         m.origin_city_id, m.destination_city_id, m.company_id, m.trip_kind, v.vehicle_type,
         os.name AS origin_state, ds.name AS destination_state
  FROM payments p
  JOIN manifests m ON m.id = p.manifest_id
  JOIN vehicles v ON v.id = m.vehicle_id
  JOIN cities oc ON oc.id = m.origin_city_id
  JOIN states os ON os.id = oc.state_id
  JOIN cities dc ON dc.id = m.destination_city_id
  JOIN states ds ON ds.id = dc.state_id
  WHERE p.status = 'paid' AND p.paid_at IS NOT NULL AND ${where}
),
${cargoSharesSql},
rows AS (
  SELECT day, 'total' AS dimension, '' AS key, NULL::text AS name, NULL::text AS name_ar,
         sum(amount)::float8 AS revenue, count(*)::int AS trips
  FROM paid GROUP BY day
  UNION ALL
  SELECT day, 'category', category, NULL, NULL, sum(amount), count(*) FROM paid GROUP BY day, category
  UNION ALL
  SELECT day, 'route', origin_city_id || '-' || destination_city_id, NULL, NULL, sum(amount), count(*)
  FROM paid GROUP BY day, origin_city_id, destination_city_id
  UNION ALL
  SELECT day, 'origin_state', origin_state, NULL, NULL, sum(amount), count(*) FROM paid GROUP BY day, origin_state
  UNION ALL
  SELECT day, 'destination_state', destination_state, NULL, NULL, sum(amount), count(*)
  FROM paid GROUP BY day, destination_state
  UNION ALL
  SELECT day, 'company', company_id::text, NULL, NULL, sum(amount), count(*) FROM paid GROUP BY day, company_id
  UNION ALL
  SELECT day, 'vehicle_type', vehicle_type, NULL, NULL, sum(amount), count(*) FROM paid GROUP BY day, vehicle_type
  UNION ALL
  SELECT day, 'trip_kind', trip_kind, NULL, NULL, sum(amount), count(*) FROM paid GROUP BY day, trip_kind
  UNION ALL
  SELECT day, 'cargo', key, NULL, NULL, sum(revenue), count(DISTINCT manifest_id)::int
  FROM cargo_shares GROUP BY day, key
  UNION ALL
  SELECT paid.day, 'charge', c.code,
         (array_agg(c.name ORDER BY c.id DESC))[1], (array_agg(c.name_ar ORDER BY c.id DESC))[1],
         sum(c.amount), count(*)
  FROM paid JOIN manifest_charges c ON c.manifest_id = paid.manifest_id
  GROUP BY paid.day, c.code
)
INSERT INTO daily_revenue (day, dimension, key, name, name_ar, revenue, trips)
SELECT day, dimension, key, name, name_ar, revenue, trips FROM rows
ON CONFLICT (day, dimension, key) DO UPDATE SET
  revenue = daily_revenue.revenue + EXCLUDED.revenue,
  trips = daily_revenue.trips + EXCLUDED.trips,
  name = coalesce(EXCLUDED.name, daily_revenue.name),
  name_ar = coalesce(EXCLUDED.name_ar, daily_revenue.name_ar)`

// A trip whose payment was just recorded as paid: call inside that transaction, once
export async function addPaidTrip(tx: Executor, manifestId: number): Promise<void> {
  await tx.execute(summarySql(sql`p.manifest_id = ${manifestId}`))
}

// While bulk writes change the payments (demo seeding and regenerating, the load-test seeder), the
// summary doesn't match them. This marker (a system_settings row) says so: it's set before such
// writes, and cleared only in the transaction that rebuilds the summary. While it's set, the
// dashboard computes its figures from the payments themselves, and the API's startup rebuilds the
// summary (a rebuild that failed is retried).
const STALE_KEY = 'daily_revenue.stale'

export async function markSummaryStale(db: Executor = getDb()): Promise<void> {
  await db.execute(sql`
    INSERT INTO system_settings (key, value) VALUES (${STALE_KEY}, 1)
    ON CONFLICT (key) DO UPDATE SET value = 1, updated_at = now()`)
}

export async function isSummaryStale(db: AppDatabase = getDb()): Promise<boolean> {
  const [row] = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, STALE_KEY))
    .limit(1)
  return (row?.value ?? 0) !== 0
}

// Recomputes the whole summary from the payments (after bulk writes) and clears the stale marker,
// together. Locks the table meanwhile, so a payment recorded at the same time waits and is
// counted once.
export async function rebuildDailyRevenue(db: AppDatabase = getDb()): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = 0`)
    await tx.execute(sql`LOCK TABLE daily_revenue IN EXCLUSIVE MODE`)
    await tx.execute(sql`DELETE FROM daily_revenue`)
    await tx.execute(summarySql(sql`true`))
    await tx.execute(sql`
      INSERT INTO system_settings (key, value) VALUES (${STALE_KEY}, 0)
      ON CONFLICT (key) DO UPDATE SET value = 0, updated_at = now()`)
  })
}

// A local (Sudan) date as YYYY-MM-DD; the API runs on Sudan time (config.ts)
export function dayOf(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
