// Masarat API: one Hono app (app.ts) serving masarat.com, owner.masarat.com and govt.masarat.com.
// This file runs the startup checks and tasks, serves the app, schedules the background jobs, and
// shuts down cleanly on SIGTERM / SIGINT (a deploy or a restart): it stops taking requests, lets
// the ones in flight finish (up to SHUTDOWN_GRACE_MS), then closes its connections.
import { app } from './app'
import { config } from './config'
import { closeDb } from './db'
import { flushLogs, log, removeOldLogs } from './log'
import { checkDbRole } from './services/dbRole'
import { clearStaging, removeOrphanFolders } from './services/documents'
import { clearStaleExports } from './services/exports'
import { ensureDemoData } from './services/demoData'
import { markStopping } from './services/health'
import { scheduleJob, stopJobs } from './services/jobs'
import { assertPricingAllowed } from './services/pricing'
import { purgeExpired } from './services/sessions'

const HOUR_MS = 60 * 60 * 1000

async function fatal(message: string, err?: unknown): Promise<never> {
  log.error(message, err)
  await flushLogs()
  process.exit(1)
}

// Production must not price trips with the development formula
try {
  assertPricingAllowed()
} catch (err) {
  await fatal((err as Error).message)
}

// The API must not connect as the owner or a superuser in production
const role = await checkDbRole().catch((err) => fatal('Cannot reach Postgres', err))
if (role.problems.length) {
  const message = `Database role ${role.role} ${role.problems.join(', ')}; connect as masarat_app`
  if (config.production) await fatal(message)
  log.warn(message)
}

// Uploads staged for trips that were never saved, and folders of deleted trips, don't outlive a
// restart. The demo companies are seeded only in demo mode.
clearStaging()
// Exports half-built when the API stopped
clearStaleExports(0)
await removeOrphanFolders()
if (config.demoMode) {
  await ensureDemoData()
  log.info('Demo mode: demo accounts and data are seeded')
}

scheduleJob({ name: 'sessions.purge', everyMs: HOUR_MS, exclusive: true, run: purgeExpired })
// Each instance deletes its own old log files
scheduleJob({
  name: 'logs.cleanup',
  everyMs: 24 * HOUR_MS,
  exclusive: false,
  run: async () => removeOldLogs()
})

const server = Bun.serve({
  port: config.port,
  // A request that sends nothing for this long is closed; Postgres's own limit (shorter) has
  // stopped its query by then. Exports lift it for themselves (routes/govt.ts).
  idleTimeout: config.requestTimeoutS,
  fetch: app.fetch
})
log.info('API listening', { port: server.port, env: config.appEnv, demoMode: config.demoMode })

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  log.info('Shutting down', { signal, inFlight: server.pendingRequests })
  // Not ready any more: the load balancer stops sending requests here
  markStopping()
  const grace = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), config.shutdownGraceMs).unref()
  )
  // stop() stops accepting connections and resolves once the requests in flight are done
  const finished = await Promise.race([server.stop(false).then(() => 'done' as const), grace])
  if (finished === 'timeout') {
    log.warn('Requests still running after the grace period; closing them', {
      inFlight: server.pendingRequests
    })
    await server.stop(true)
  }
  await stopJobs()
  await closeDb()
  log.info('Stopped')
  await flushLogs()
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
