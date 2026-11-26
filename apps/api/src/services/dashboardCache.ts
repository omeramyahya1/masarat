// The government dashboard is figures over a month or more of trips: computed in full on every
// visit, a few visits a second keep Postgres busy. The figures may be a minute old (the portal
// caches them for a minute too), so each set of filters and view is computed once and kept in
// Redis for DASHBOARD_CACHE_S (60 s), shared by every API instance. Requests for the same
// dashboard while it's being computed wait for that one computation (per instance). If Redis
// can't be reached the dashboard is computed as before.
import { createHash } from 'crypto'
import type { AnalyticsFilters, DashboardView } from '@masarat/shared/analytics'
import type { DashboardData, DashboardHistory, DashboardToday } from '@masarat/shared/dashboard'
import { config } from '../config'
import { log } from '../log'
import { dayOf } from './dailyRevenue'
import { getDashboard } from './dashboard'
import { DASHBOARD_AGGREGATE_HOUR, dashboardHistory, dashboardToday } from './dashboardFacts'
import { getRedis, withTimeout } from './redis'

// Bumped to drop every cached dashboard at once (after regenerating the demo data)
const GENERATION_KEY = 'dashboard:generation'
const computing = new Map<string, Promise<unknown>>()

async function cacheKey(name: string, payload: unknown): Promise<string> {
  const generation = (await withTimeout(getRedis().get(GENERATION_KEY))) ?? '0'
  // The day is part of it: "the last 30 days" means other dates tomorrow
  const hash = createHash('sha1')
    .update(JSON.stringify({ payload, day: dayOf(new Date()) }))
    .digest('hex')
  return `dashboard:${generation}:${name}:${hash}`
}

// A computed value, from Redis while it lasts (ttlS seconds); computed once per instance at a time
export async function cachedValue<T>(
  name: string,
  payload: unknown,
  ttlS: number,
  compute: () => Promise<T>
): Promise<T> {
  if (ttlS <= 0) return compute()
  let key: string
  try {
    key = await cacheKey(name, payload)
    const hit = await withTimeout(getRedis().get(key))
    if (hit) return JSON.parse(hit) as T
  } catch (err) {
    log.warn('Dashboard cache unavailable; computing it', err)
    return compute()
  }
  const running = computing.get(key) as Promise<T> | undefined
  if (running) return running
  const computation = compute()
    .then(async (data) => {
      try {
        await withTimeout(getRedis().set(key, JSON.stringify(data), 'EX', Math.ceil(ttlS)))
      } catch (err) {
        log.warn('Storing the dashboard in the cache failed', err)
      }
      return data
    })
    .finally(() => computing.delete(key))
  computing.set(key, computation as Promise<unknown>)
  return computation
}

export const cachedDashboard = (
  filters: AnalyticsFilters,
  view: DashboardView
): Promise<DashboardData> =>
  cachedValue('full', { filters, view }, config.dashboardCacheS, () => getDashboard(filters, view))

// Seconds until the next nightly aggregation (01:00), at least a minute
export function secondsUntilNextAggregation(now = new Date()): number {
  const next = new Date(now)
  next.setHours(DASHBOARD_AGGREGATE_HOUR, 5, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  return Math.max(60, (next.getTime() - now.getTime()) / 1000)
}

// The history only changes at night; today's figures for 30 s
export const cachedHistory = (
  filters: AnalyticsFilters,
  view: DashboardView
): Promise<DashboardHistory> =>
  cachedValue(
    'history',
    { filters, view },
    config.dashboardCacheS > 0 ? secondsUntilNextAggregation() : 0,
    () => dashboardHistory(filters, view)
  )

export const cachedToday = (
  filters: AnalyticsFilters,
  view: DashboardView
): Promise<DashboardToday> =>
  cachedValue('today', { filters, view }, config.dashboardCacheS > 0 ? 30 : 0, () =>
    dashboardToday(filters, view)
  )

// Every cached dashboard is dropped (the data changed in bulk)
export async function clearDashboardCache(): Promise<void> {
  try {
    await withTimeout(getRedis().incr(GENERATION_KEY))
  } catch (err) {
    log.warn('Clearing the dashboard cache failed', err)
  }
}
