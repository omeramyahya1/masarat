// A per-IP request limit for public routes, kept in memory (the API runs as one server). Over the
// limit, requests get 429 until the window has moved on.
import { createMiddleware } from 'hono/factory'
import { clientInfo, fail, type AppEnv } from './context'

export function rateLimit(
  limit: number,
  windowMs: number
): ReturnType<typeof createMiddleware<AppEnv>> {
  const hits = new Map<string, number[]>()
  return createMiddleware<AppEnv>(async (c, next) => {
    const now = Date.now()
    const ip = clientInfo(c).ip ?? 'unknown'
    const recent = (hits.get(ip) ?? []).filter((at) => now - at < windowMs)
    if (recent.length >= limit) return fail(c, 'too_many_attempts')
    recent.push(now)
    hits.set(ip, recent)
    // Forget IPs that have gone quiet, so the map doesn't grow without end
    if (hits.size > 10_000) {
      for (const [key, times] of hits)
        if (times.every((at) => now - at >= windowMs)) hits.delete(key)
    }
    return next()
  })
}
