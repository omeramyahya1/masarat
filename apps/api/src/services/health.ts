// Readiness: whether this API instance can serve requests, i.e. reach everything it depends on.
// The load balancer sends traffic only to instances whose GET /health/ready answers 200; GET /health
// only says the process is alive.
import { sql } from 'drizzle-orm'
import { getDb } from '../db'

type Check = () => Promise<void>

const TIMEOUT_MS = 2_000

// Each dependency's check, by name. Other modules (Redis, object storage) add theirs.
const checks = new Map<string, Check>([
  [
    'postgres',
    async () => {
      await getDb().execute(sql`select 1`)
    }
  ]
])

export function addReadinessCheck(name: string, check: Check): void {
  checks.set(name, check)
}

// Set while the API is shutting down: it stops being ready at once, so the balancer moves on
let stopping = false
export const markStopping = (): void => {
  stopping = true
}

export interface Readiness {
  ready: boolean
  checks: Record<string, 'ok' | 'failed' | 'stopping'>
}

export async function readiness(): Promise<Readiness> {
  const results: Readiness['checks'] = {}
  await Promise.all(
    [...checks].map(async ([name, check]) => {
      if (stopping) {
        results[name] = 'stopping'
        return
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          check(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)
          })
        ])
        results[name] = 'ok'
      } catch {
        results[name] = 'failed'
      } finally {
        clearTimeout(timer)
      }
    })
  )
  return { ready: Object.values(results).every((r) => r === 'ok'), checks: results }
}
