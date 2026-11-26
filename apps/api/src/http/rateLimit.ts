// A per-IP request limit for public routes, kept in Redis so every API instance counts the same
// requests: a fixed window per IP (INCR, with the window's expiry set by the first request). Over
// the limit, requests get 429 until the window ends. If Redis can't be reached the request goes
// through (logged): checkpoint officers must still be able to verify a manifest.
import { createMiddleware } from 'hono/factory'
import { log } from '../log'
import { getRedis, withTimeout } from '../services/redis'
import { clientInfo, fail, type AppEnv } from './context'

export function rateLimit(
  name: string,
  // A number, or read at each request (a setting the tests can change)
  limit: number | (() => number),
  windowMs: number
): ReturnType<typeof createMiddleware<AppEnv>> {
  const windowS = Math.max(1, Math.round(windowMs / 1000))
  return createMiddleware<AppEnv>(async (c, next) => {
    const ip = clientInfo(c).ip ?? 'unknown'
    const window = Math.floor(Date.now() / (windowS * 1000))
    const key = `rate:${name}:${ip}:${window}`
    try {
      const redis = getRedis()
      const count = await withTimeout(redis.incr(key))
      if (count === 1) await withTimeout(redis.expire(key, windowS))
      if (count > (typeof limit === 'function' ? limit() : limit))
        return fail(c, 'too_many_attempts')
    } catch (err) {
      log.warn('Rate limit unavailable; request allowed', err, { name })
    }
    return next()
  })
}
