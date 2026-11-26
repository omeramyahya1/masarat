// The dashboard as the portal shows it: the history (whole past days, from the nightly aggregates,
// kept until the next night) and today (live), fetched separately and added together
// (mergeDashboard). The dashboard caches each part in TanStack Query; the report fetches both.
import { mergeDashboard, type DashboardData } from '@masarat/shared/dashboard'
import type { AnalyticsFilters, DashboardView } from '@masarat/shared/analytics'
import { unwrap } from '@masarat/ui/lib/query'
import { api } from '@masarat/api-client'

// The aggregates are rebuilt from 01:00; the history is kept until shortly after
export function msUntilNextAggregation(now = new Date()): number {
  const next = new Date(now)
  next.setHours(1, 10, 0, 0)
  if (next <= now) next.setDate(next.getDate() + 1)
  return next.getTime() - now.getTime()
}

export async function loadDashboard(
  filters: AnalyticsFilters,
  view: DashboardView
): Promise<DashboardData> {
  const [history, today] = await Promise.all([
    unwrap(api.govt.dashboardHistory(filters, view)),
    unwrap(api.govt.dashboardToday(filters, view))
  ])
  return mergeDashboard(filters, view, new Date(), history, today)
}
