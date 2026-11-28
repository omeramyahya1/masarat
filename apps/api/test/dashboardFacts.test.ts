// The dashboard from nightly aggregates: the history (whole past days, from dashboard_facts) and
// today (live) add up to the same figures the dashboard computes live over every trip.
import { beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { mergeDashboard } from '@masarat/shared/dashboard'
import type { AnalyticsFilters, DashboardView } from '@masarat/shared/analytics'
import { ensureDemoData } from '../src/services/demoData'
import { getDashboard } from '../src/services/dashboard'
import {
  aggregateDashboard,
  aggregatedThrough,
  dashboardHistory,
  dashboardToday,
  nightlyDashboardAggregate,
  resetDashboardFacts
} from '../src/services/dashboardFacts'
import { getDb } from '../src/db'
import { resetData, signedIn, type Browser } from './helpers'

let govt: Browser

beforeAll(async () => {
  await resetData()
  govt = (await signedIn('facts.admin', 'govt_admin')).b
  await ensureDemoData()
  await resetDashboardFacts()
  await aggregateDashboard()
}, 120_000)

// Sums of floating-point shares: equal to a millionth
const close = (a: number, b: number): void =>
  expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.max(0.01, Math.abs(b) * 1e-6))

async function both(
  filters: AnalyticsFilters,
  view: DashboardView
): Promise<{
  merged: ReturnType<typeof mergeDashboard>
  live: Awaited<ReturnType<typeof getDashboard>>
}> {
  const now = new Date()
  const [history, today, live] = await Promise.all([
    dashboardHistory(filters, view, now),
    dashboardToday(filters, view, now),
    getDashboard(filters, view, 'live')
  ])
  return { merged: mergeDashboard(filters, view, now, history, today), live }
}

describe('dashboard aggregates', () => {
  test('the nightly aggregates cover up to yesterday, once a day from 01:00', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const pad = (n: number): string => String(n).padStart(2, '0')
    expect(await aggregatedThrough()).toBe(
      `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`
    )
    // Already done today; before 01:00 it never runs
    expect(await nightlyDashboardAggregate()).toBe(0)
    const early = new Date()
    early.setHours(0, 30)
    expect(await nightlyDashboardAggregate(early)).toBe(0)
  })

  for (const [label, filters] of [
    ['unfiltered, 90 days', { range: { preset: '90d' } }],
    ['passengers, 12 months', { range: { preset: '12m' }, category: 'passenger' }],
    ['from a state, this year', { range: { preset: 'ytd' }, originState: 'Khartoum' }]
  ] as [string, AnalyticsFilters][]) {
    test(`history + today match the live figures: ${label}`, async () => {
      const view: DashboardView = { bucket: null, breakdown: 'route', sort: 'revenue' }
      const { merged, live } = await both(filters, view)
      close(merged.kpis.revenue, live.kpis.revenue)
      expect(merged.kpis.certificatesIssued).toBe(live.kpis.certificatesIssued)
      expect(merged.kpis.pendingBills).toBe(live.kpis.pendingBills)
      expect(merged.kpis.activeTrips).toBe(live.kpis.activeTrips)
      if (live.kpis.collectionRate === null) expect(merged.kpis.collectionRate).toBeNull()
      else close(merged.kpis.collectionRate!, live.kpis.collectionRate)
      // The previous period is whole days here (the live dashboard starts it at the exact time)
      if (live.kpis.previousRevenue !== null) expect(merged.kpis.previousRevenue).not.toBeNull()
      expect(merged.statusCounts).toEqual(live.statusCounts)
      expect(merged.revenueSeries.length).toBe(live.revenueSeries.length)
      merged.revenueSeries.forEach((p, i) => close(p.revenue, live.revenueSeries[i].revenue))
      const byKey = <T extends { revenue: number }>(
        rows: T[],
        key: (r: T) => string
      ): Map<string, number> => new Map(rows.map((r) => [key(r), r.revenue]))
      const cargo = byKey(live.byCargo, (c) => c.cargoType)
      for (const c of merged.byCargo) close(c.revenue, cargo.get(c.cargoType) ?? 0)
      const tax = byKey(live.byTax, (t) => t.code)
      for (const t of merged.byTax) close(t.revenue, tax.get(t.code) ?? 0)
      const routes = byKey(live.breakdown, (r) => r.key)
      expect(merged.breakdown.length).toBe(live.breakdown.length)
      for (const r of merged.breakdown) close(r.revenue, routes.get(r.key) ?? 0)
    }, 60_000)
  }

  test('the company breakdown comes from its own rollup', async () => {
    const view: DashboardView = { bucket: null, breakdown: 'company', sort: 'revenue' }
    const { merged, live } = await both({ range: { preset: '30d' } }, view)
    const companies = new Map(live.breakdown.map((r) => [r.key, r.revenue]))
    expect(merged.breakdown.length).toBe(live.breakdown.length)
    for (const r of merged.breakdown) {
      close(r.revenue, companies.get(r.key) ?? 0)
      expect(r.name).toBeTruthy()
    }
  })

  test('a day the nightly job missed is computed live', async () => {
    // As if the last three nights didn't run
    const view: DashboardView = { bucket: null, breakdown: 'route', sort: 'revenue' }
    const filters: AnalyticsFilters = { range: { preset: '7d' } }
    const before = await dashboardHistory(filters, view)
    const back = new Date()
    back.setDate(back.getDate() - 4)
    const pad = (n: number): string => String(n).padStart(2, '0')
    const day = `${back.getFullYear()}${pad(back.getMonth() + 1)}${pad(back.getDate())}`
    await getDb().execute(
      sql`UPDATE system_settings SET value = ${Number(day)} WHERE key = 'dashboard.aggregated_through'`
    )
    await getDb().execute(
      sql`DELETE FROM dashboard_facts WHERE day > ${back.toISOString().slice(0, 10)}`
    )
    const after = await dashboardHistory(filters, view)
    close(after.part.revenue, before.part.revenue)
    await aggregateDashboard()
  })

  test('each whole month is its days added up, in the monthly facts', async () => {
    const totals = async (
      table: 'dashboard_facts' | 'dashboard_facts_month'
    ): Promise<{ kind: string; value: number; n: number }[]> =>
      getDb().execute<{ kind: string; value: number; n: number }>(
        sql`SELECT kind, round(sum(value)::numeric, 2)::float8 AS value, sum(n)::int AS n
            FROM ${sql.raw(table)}
            WHERE day >= date_trunc('month', now() - interval '2 months')
              AND day < date_trunc('month', now())
            GROUP BY kind ORDER BY kind`
      )
    const daily = await totals('dashboard_facts')
    expect(daily.length).toBeGreaterThan(0)
    expect(await totals('dashboard_facts_month')).toEqual(daily)
  })

  test('months without their monthly facts get them on the next aggregation', async () => {
    const count = async (): Promise<number> =>
      Number(
        (
          await getDb().execute<{ n: number }>(
            sql`SELECT count(*)::int AS n FROM dashboard_facts_month`
          )
        )[0]!.n
      )
    const before = await count()
    expect(before).toBeGreaterThan(0)
    // As on a database aggregated before the monthly facts existed
    await getDb().execute(sql`DELETE FROM dashboard_facts_month`)
    await aggregateDashboard()
    expect(await count()).toBe(before)
  })

  test('a renamed charge keeps all its revenue, under its latest name', async () => {
    const view: DashboardView = { bucket: null, breakdown: 'route', sort: 'revenue' }
    const filters: AnalyticsFilters = { range: { preset: '12m' } }
    const before = await dashboardHistory(filters, view)
    const vat = before.part.byTax.find((t) => t.code === 'vat')!
    expect(vat).toBeDefined()
    // VAT was called something else until two months ago
    const rename = (name: string): Promise<unknown> =>
      Promise.all(
        ['dashboard_facts', 'dashboard_facts_month'].map((table) =>
          getDb().execute(
            sql`UPDATE ${sql.raw(table)} SET name = ${name}
                WHERE kind = 'charge' AND key = 'vat' AND day < date_trunc('month', now() - interval '2 months')`
          )
        )
      )
    await rename('Old VAT')
    try {
      const after = (await dashboardHistory(filters, view)).part.byTax.filter(
        (t) => t.code === 'vat'
      )
      expect(after).toHaveLength(1)
      expect(after[0]!.name).toBe(vat.name)
      close(after[0]!.revenue, vat.revenue)
    } finally {
      await rename(vat.name)
    }
  })

  test('the routes answer both parts', async () => {
    const body = {
      filters: { range: { preset: '30d' } },
      view: { bucket: null, breakdown: 'route', sort: 'revenue' }
    }
    const history = await govt.call('POST', '/govt/dashboard/history', body)
    const today = await govt.call('POST', '/govt/dashboard/today', body)
    expect(history.status).toBe(200)
    expect(today.status).toBe(200)
    expect(history.body.data.part.revenue).toBeGreaterThan(0)
    expect(today.body.data.now).toHaveProperty('pendingBills')
  })
})
