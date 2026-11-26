// The rolling window: the live trip tables hold about a month; finished trips older than that move
// to the archive (schema `archive`, warm storage), where they stay readable through the all_*
// views (the trips list for an older period, a trip's page, the government search and exports, the
// verify page, vehicles' and drivers' trip counts). Nothing is deleted: how long the archive keeps
// trips is the agency's decision (docs/deployment).
//
// A trip moves once it left more than HOT_DAYS ago (30) and is finished: authorized (certified) or
// cancelled, or a draft nobody has touched for HOT_DAYS. A billed trip waiting for payment stays
// live until it's paid. Trips move in batches, each one transaction (copy, then delete), so a run
// can stop anywhere and the next one carries on; the daily revenue summary isn't touched (it
// already counts every paid trip). The job runs at night (ARCHIVE_HOURS), on one instance.
import { getTableColumns, getTableName, sql, type SQL } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { config } from '../config'
import { archive, getDb } from '../db'
import { log } from '../log'

export const archiveLimits = { batch: 5_000 }
// Local hours (Sudan) the job moves trips in: the quiet hours
export const ARCHIVE_HOURS = { from: 1, to: 5 }
// A run stops after this long and leaves the rest for the next one
const RUN_BUDGET_MS = 30 * 60 * 1000

// Children first in deletes, parents first in copies
const CHILDREN = [
  archive.manifestCargoItems,
  archive.manifestTrailers,
  archive.tripPassengers,
  archive.tripDocuments,
  archive.manifestCharges,
  archive.payments,
  archive.certificates
]

const columnList = (table: PgTable): SQL =>
  sql.raw(
    Object.values(getTableColumns(table))
      .map((column) => `"${column.name}"`)
      .join(', ')
  )

// Copies the rows of one table (live → archive) that belong to the batch, then nothing else
function copyRows(table: PgTable, key: 'id' | 'manifest_id'): SQL {
  const name = getTableName(table)
  const columns = columnList(table)
  return sql`INSERT INTO ${sql.raw(`"archive"."${name}"`)} (${columns})
    SELECT ${columns} FROM ${sql.raw(`"public"."${name}"`)}
    WHERE ${sql.raw(`"${key}"`)} IN (SELECT id FROM archive_batch)`
}

function deleteRows(table: PgTable, key: 'id' | 'manifest_id'): SQL {
  return sql`DELETE FROM ${sql.raw(`"public"."${getTableName(table)}"`)}
    WHERE ${sql.raw(`"${key}"`)} IN (SELECT id FROM archive_batch)`
}

// Moves one batch; returns how many trips moved (0: nothing left to move)
export async function archiveBatch(cutoff: Date): Promise<number> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = ${sql.raw(String(2 * 60 * 1000))}`)
    // The batch, locked: a payment refreshed or a draft edited meanwhile waits for it, or is
    // skipped here and moves next time
    await tx.execute(sql`
      CREATE TEMP TABLE archive_batch ON COMMIT DROP AS
      SELECT id FROM manifests
      WHERE departure_at < ${cutoff.toISOString()}::timestamptz
        AND (status IN ('certified', 'cancelled')
          OR (status = 'draft' AND updated_at < ${cutoff.toISOString()}::timestamptz))
      ORDER BY id
      LIMIT ${archiveLimits.batch}
      FOR UPDATE SKIP LOCKED`)
    const [{ count }] = await tx.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM archive_batch`
    )
    if (count === 0) return 0
    await tx.execute(copyRows(archive.manifests, 'id'))
    for (const table of CHILDREN) await tx.execute(copyRows(table, 'manifest_id'))
    for (const table of CHILDREN) await tx.execute(deleteRows(table, 'manifest_id'))
    await tx.execute(deleteRows(archive.manifests, 'id'))
    return count
  })
}

// The cutoff: trips that left before it may move
export function archiveCutoff(now = new Date()): Date {
  return new Date(now.getTime() - config.hotDays * 24 * 60 * 60 * 1000)
}

// Moves every trip that's due, batch by batch, within the run's time budget
export async function archiveDueTrips(now = new Date()): Promise<number> {
  const cutoff = archiveCutoff(now)
  const started = Date.now()
  let moved = 0
  for (;;) {
    const count = await archiveBatch(cutoff)
    moved += count
    if (count < archiveLimits.batch) break
    if (Date.now() - started > RUN_BUDGET_MS) {
      log.info('Archive run stopped at its time budget; the next run carries on', { moved })
      break
    }
  }
  if (moved > 0) log.info('Trips moved to the archive', { moved, cutoff })
  return moved
}

// The hourly job: does the work only in the quiet hours
export async function nightlyArchive(now = new Date()): Promise<number> {
  const hour = now.getHours()
  if (hour < ARCHIVE_HOURS.from || hour >= ARCHIVE_HOURS.to) return 0
  return archiveDueTrips(now)
}
