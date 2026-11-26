// Overload protection: at most MAX_IN_FLIGHT requests at once per API instance. Past that, a request
// is answered 503 server_busy at once (with Retry-After), instead of waiting its turn for a
// Postgres connection for minutes while its user has long given up, which only makes the backlog
// grow (the load test saw requests waiting 15 minutes). The health checks are never refused, so
// the load balancer still sees the instance. A request whose client is already gone is dropped.
import type { MiddlewareHandler } from 'hono'
import { config } from '../config'
import type { AppEnv } from './context'

let inFlight = 0

export const requestsInFlight = (): number => inFlight

export const shedLoad: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.path === '/health' || c.req.path === '/health/ready') return next()
  // Closed by the client while it waited to be read: nobody would get the answer
  if (c.req.raw.signal?.aborted) return c.body(null, 499 as never)
  if (inFlight >= config.maxInFlight) {
    c.header('Retry-After', '1')
    return c.json({ ok: false, error: 'server_busy' }, 503)
  }
  inFlight++
  try {
    await next()
  } finally {
    inFlight--
  }
}
