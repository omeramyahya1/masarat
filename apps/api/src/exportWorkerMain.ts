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

// Half-built exports left by a stopped worker (this machine's scratch space), as old as any
// export can still be running: another worker on the same machine may be building one now
clearStaleExports()

const inProgress = new Set<Promise<void>>()
let stopping = false
// The poll taking exports now, if any: shutdown lets it end before it counts what's in progress
let activePoll: Promise<void> | null = null

function poll(): Promise<void> {
  if (stopping || activePoll) return activePoll ?? Promise.resolve()
  activePoll = startQueuedExports({
    // Each export counts as in progress the moment it starts
    onStart: (run) => {
      inProgress.add(run)
      void run.finally(() => inProgress.delete(run))
    },
    stop: () => stopping
  })
    .then(() => undefined)
    .catch((err) => log.error('Could not take exports from the queue', err))
    .finally(() => {
      activePoll = null
    })
  return activePoll
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
  // A claim under way first (it takes no more after this one), then the exports in progress,
  // all within the one grace period
  const finished = await Promise.race([
    (activePoll ?? Promise.resolve())
      .then(() => Promise.allSettled([...inProgress]))
      .then(() => 'done'),
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
