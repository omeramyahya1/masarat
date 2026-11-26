// Background jobs the API runs on a timer (purging expired sessions, sweeping unused uploads,
// moving old trips to the archive, deleting old log files). Several API instances may run at once:
// a job that must run once per round takes a Postgres advisory lock, so only one instance does it
// and the others skip that round.
import { sql } from 'drizzle-orm'
import { getDb } from '../db'
import { log } from '../log'

interface Job {
  name: string
  everyMs: number
  // Whether only one instance may run it at a time (false: every instance does, e.g. its own logs)
  exclusive: boolean
  run: () => Promise<unknown>
}

const jobs: Job[] = []
const timers: ReturnType<typeof setInterval>[] = []
const running = new Set<Promise<void>>()
let stopped = false

// A stable 32-bit key per job name, for pg_try_advisory_lock
function lockKey(name: string): number {
  let hash = 0
  for (const ch of name) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0
  return hash
}

export async function runJob(job: Job): Promise<void> {
  if (stopped) return
  const started = performance.now()
  try {
    if (!job.exclusive) {
      await job.run()
    } else {
      // A session-level lock needs one connection for the lock, the job and the unlock
      const ran = await getDb().transaction(async (tx) => {
        const [row] = await tx.execute<{ locked: boolean }>(
          sql`select pg_try_advisory_xact_lock(${lockKey(job.name)}) as locked`
        )
        if (!row?.locked) return false
        await job.run()
        return true
      })
      if (!ran) {
        log.debug('Job skipped: another instance is running it', { job: job.name })
        return
      }
    }
    log.info('Job done', { job: job.name, ms: Math.round(performance.now() - started) })
  } catch (err) {
    log.error('Job failed', err, { job: job.name })
  }
}

// Runs the job now (unless `immediately` is false) and then every `everyMs`
export function scheduleJob(job: Job, immediately = true): void {
  jobs.push(job)
  const start = (): void => {
    const run = runJob(job).finally(() => running.delete(run))
    running.add(run)
  }
  if (immediately) start()
  timers.push(setInterval(start, job.everyMs))
}

// Stops the timers and waits for the jobs in progress (on shutdown)
export async function stopJobs(): Promise<void> {
  stopped = true
  for (const timer of timers) clearInterval(timer)
  await Promise.allSettled([...running])
}
