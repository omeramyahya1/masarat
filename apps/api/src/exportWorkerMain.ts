// The export worker's process (see exportWorker.ts): checks, then takes queued exports every
// second while there's room (services/exportWorker.ts), deletes expired files, and on SIGTERM /
// SIGINT stops taking exports and gives the ones in progress SHUTDOWN_GRACE_MS to finish. An
// export cut short then loses its lease and is marked failed by the next claim.
import { config } from './config'
import { closeDb } from './db'
import { flushLogs, log, removeOldLogs } from './log'
import { checkDbRole } from './services/dbRole'
import { clearStaleExports } from './services/exports'
import { startQueuedExports, sweepExportFiles } from './services/exportWorker'
import { scheduleJob, stopJobs } from './services/jobs'
import { closeRedis } from './services/redis'

const POLL_MS = 1_000
const HOUR_MS = 60 * 60 * 1000

const role = await checkDbRole().catch(async (err) => {
  log.error('Cannot reach Postgres', err)
  await flushLogs()
  process.exit(1)
})
if (role.problems.length) {
  const message = `Database role ${role.role} ${role.problems.join(', ')}; connect as masarat_app`
  if (config.production) {
    log.error(message)
    await flushLogs()
    process.exit(1)
  }
  log.warn(message)
}

// Half-built exports from before a restart (this machine's scratch space)
clearStaleExports(0)

const inProgress = new Set<Promise<void>>()
let stopping = false
let polling = false

async function poll(): Promise<void> {
  if (stopping || polling) return
  polling = true
  try {
    for (const run of await startQueuedExports()) {
      inProgress.add(run)
      void run.finally(() => inProgress.delete(run))
    }
  } catch (err) {
    log.error('Could not take exports from the queue', err)
  } finally {
    polling = false
  }
}
const timer = setInterval(() => void poll(), POLL_MS)
void poll()

// Expired export files in the bucket (one worker at a time); this worker's own old log files
scheduleJob({
  name: 'exports.sweep',
  everyMs: HOUR_MS / 6,
  exclusive: true,
  run: () => sweepExportFiles()
})
scheduleJob({
  name: 'logs.cleanup',
  everyMs: 24 * HOUR_MS,
  exclusive: false,
  run: async () => removeOldLogs()
})
log.info('Export worker started', {
  env: config.appEnv,
  concurrency: config.exportConcurrency ?? 'one per government admin or supervisor'
})

async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  clearInterval(timer)
  log.info('Export worker stopping', { signal, inProgress: inProgress.size })
  const grace = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), config.shutdownGraceMs).unref()
  )
  const finished = await Promise.race([
    Promise.allSettled([...inProgress]).then(() => 'done'),
    grace
  ])
  if (finished === 'timeout') {
    log.warn('Exports still running after the grace period; their leases will run out', {
      inProgress: inProgress.size
    })
  }
  await stopJobs()
  await closeDb()
  closeRedis()
  log.info('Export worker stopped')
  await flushLogs()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
