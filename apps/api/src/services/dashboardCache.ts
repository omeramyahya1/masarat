// The government dashboard is figures over a month or more of trips: computed in full on every
// visit, a few visits a second keep Postgres busy. The figures may be a minute old (the portal
// caches them for a minute too), so each set of filters and view is computed once and kept in
// Redis for DASHBOARD_CACHE_S (60 s), shared by every API instance. Requests for the same
// dashboard while it's being computed wait for that one computation (per instance). If Redis
// can't be reached the dashboard is computed as before.
import { createHash } from 'crypto'
import type { AnalyticsFilters, DashboardView } from '@masarat/shared/analytics'
import type { DashboardData } from '@masarat/shared/dashboard'
import { config } from '../config'
import { log } from '../log'
import { dayOf } from './dailyRevenue'
import { getDashboard } from './dashboard'
import { getRedis, withTimeout } from './redis'

// Bumped to drop every cached dashboard at once (after regenerating the demo data)
const GENERATION_KEY = 'dashboard:generation'
const computing = new Map<string, Promise<DashboardData>>()

async function cacheKey(filters: AnalyticsFilters, view: DashboardView): Promise<string> {
  const generation = (await withTimeout(getRedis().get(GENERATION_KEY))) ?? '0'
  // The day is part of it: "the last 30 days" means other dates tomorrow
  const hash = createHash('sha1')
    .update(JSON.stringify({ filters, view, day: dayOf(new Date()) }))
    .digest('hex')
  return `dashboard:${generation}:${hash}`
}

export async function cachedDashboard(
  filters: AnalyticsFilters,
  view: DashboardView
): Promise<DashboardData> {
  if (config.dashboardCacheS <= 0) return getDashboard(filters, view)
  let key: string
  try {
    key = await cacheKey(filters, view)
    const hit = await withTimeout(getRedis().get(key))
    if (hit) return JSON.parse(hit) as DashboardData
  } catch (err) {
    log.warn('Dashboard cache unavailable; computing it', err)
    return getDashboard(filters, view)
  }
  // One computation per dashboard at a time on this instance
  const running = computing.get(key)
  if (running) return running
  const computation = getDashboard(filters, view)
    .then(async (data) => {
      try {
        await withTimeout(getRedis().set(key, JSON.stringify(data), 'EX', config.dashboardCacheS))
      } catch (err) {
        log.warn('Storing the dashboard in the cache failed', err)
      }
      return data
    })
    .finally(() => computing.delete(key))
  computing.set(key, computation)
  return computation
}

// Every cached dashboard is dropped (the data changed in bulk)
export async function clearDashboardCache(): Promise<void> {
  try {
    await withTimeout(getRedis().incr(GENERATION_KEY))
  } catch (err) {
    log.warn('Clearing the dashboard cache failed', err)
  }
}
