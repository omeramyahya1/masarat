// What the export worker does with a queued export (services/exportQueue.ts): build its files with
// exportData on this machine's scratch disk, upload the one download (a file, or the ZIP of
// several) to the bucket, and record the outcome. The process around it is src/exportWorker.ts.
import { config } from '../config'
import { log } from '../log'
import {
  claimExport,
  dropCancelled,
  exportConcurrency,
  exportObjectKey,
  finishExport,
  isCancelled,
  renewLease,
  type StoredExportJob
} from './exportQueue'
import { exportContentType, exportData } from './exports'
import { objectStore } from './storage'

// A lease outlives a few missed renewals; a worker that died loses its exports after this long
export const EXPORT_LEASE_MS = 60_000
const RENEW_EVERY_MS = 15_000

// Builds one claimed export, renewing its lease meanwhile. Never throws: a failure is the job's.
export async function runExport(job: StoredExportJob): Promise<void> {
  const started = performance.now()
  let leaseLost = false
  const renew = setInterval(() => {
    renewLease(job.id, EXPORT_LEASE_MS)
      .then((kept) => {
        if (!kept) leaseLost = true
      })
      .catch((err) => log.warn('Could not renew an export lease', { exportId: job.id }, err))
  }, RENEW_EVERY_MS)
  try {
    const result = await exportData(job.input)
    if (!result.ok) {
      await finishExport(job, { error: result.error, rows: result.rows })
      log.info('Export refused', { exportId: job.id, error: result.error, rows: result.rows })
      return
    }
    const { download, rows, cleanup } = result.data
    try {
      if (leaseLost) {
        log.warn('Export finished after its lease ran out; discarded', { exportId: job.id })
        return
      }
      if (await isCancelled(job.id)) {
        await dropCancelled(job)
        log.info('Export cancelled while it was prepared', { exportId: job.id })
        return
      }
      const key = exportObjectKey(job.id, download.name)
      await objectStore.putFile(key, download.path, exportContentType(download.name))
      if (!(await finishExport(job, { file: { key, name: download.name }, rows }))) {
        // Cancelled (or given up) while its file was uploading: the file isn't offered; the
        // hourly sweep deletes it
        await dropCancelled(job)
        log.info('Export ended otherwise while its file was uploading; discarded', {
          exportId: job.id
        })
        return
      }
      log.info('Export ready', {
        exportId: job.id,
        rows,
        ms: Math.round(performance.now() - started),
        waitedMs: (job.startedAt ?? job.createdAt) - job.createdAt
      })
    } finally {
      cleanup()
    }
  } catch (err) {
    log.error('Export failed', { exportId: job.id }, err)
    await finishExport(job, { error: 'export_failed' }).catch((e) =>
      log.error('Could not record a failed export', { exportId: job.id }, e)
    )
  } finally {
    clearInterval(renew)
  }
}

// Takes queued exports while there's room (the limit is across every worker) and starts each.
// Returns the exports it started, so a caller (the tests) can wait for them. `onStart` hears of
// each one as it starts, so a later claim that fails can't hide it from the caller (the worker's
// shutdown waits for them); `stop` ends the claiming before the next one.
export async function startQueuedExports({
  onStart,
  stop
}: { onStart?: (run: Promise<void>) => void; stop?: () => boolean } = {}): Promise<
  Promise<void>[]
> {
  const limit = await exportConcurrency(config.exportConcurrency)
  const started: Promise<void>[] = []
  for (;;) {
    if (stop?.()) return started
    const { job } = await claimExport(limit, EXPORT_LEASE_MS)
    if (!job) return started
    log.info('Export started', { exportId: job.id, limit })
    const run = runExport(job)
    started.push(run)
    onStart?.(run)
  }
}

// Runs every queued export to its end (the tests, and a one-off run)
export async function drainExports(): Promise<void> {
  for (;;) {
    const started = await startQueuedExports()
    if (started.length === 0) return
    await Promise.all(started)
  }
}

// Finished exports' files are kept an hour (EXPORT_FILE_TTL_MS); older ones are deleted
export async function sweepExportFiles(
  maxAgeMs = 60 * 60 * 1000,
  now = Date.now()
): Promise<number> {
  const old = (await objectStore.list('exports/')).filter(
    (o) => now - o.lastModified.getTime() > maxAgeMs
  )
  await objectStore.delete(old.map((o) => o.key))
  return old.length
}
