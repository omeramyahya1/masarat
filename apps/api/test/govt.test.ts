// The government portal's routes: access, dashboard, paged search, read-only trips and their
// files, taxes and fees, the data export (one file or a ZIP), and the demo regenerate
import { beforeAll, describe, expect, test } from 'bun:test'
import { strFromU8, unzipSync } from 'fflate'
import { ensureDemoData } from '../src/services/demoData'
import { getDashboard } from '../src/services/dashboard'
import {
  dayOf,
  isSummaryStale,
  markSummaryStale,
  rebuildDailyRevenue
} from '../src/services/dailyRevenue'
import { exportLimits } from '../src/services/exports'
import { SEARCH_CAP } from '../src/services/govtTrips'
import { BREAKDOWNS } from '@masarat/shared/analytics'
import { certificates, getDb, manifests, payments, tripDocuments, vehicles } from '../src/db'
import { eq, sql } from 'drizzle-orm'
import { resetData, signedIn, type Browser } from './helpers'

const LABELS = { columns: {}, sheets: {}, values: {} }
let govt: Browser
let agent: Browser
let owner: Browser

beforeAll(async () => {
  await resetData()
  await ensureDemoData()
  govt = (await signedIn('inspector', 'govt_admin')).b
  agent = (await signedIn('analyst', 'govt_agent')).b
  owner = (await signedIn('owner.x', 'company_admin')).b
}, 60_000)

describe('access', () => {
  test('companies are refused every government route', async () => {
    for (const [method, path] of [
      ['GET', '/govt/reference'],
      ['GET', '/govt/companies'],
      ['POST', '/govt/dashboard'],
      ['GET', '/govt/search?query=nile'],
      ['GET', '/govt/trips/1'],
      ['GET', '/govt/charges'],
      ['POST', '/govt/exports']
    ]) {
      expect((await owner.call(method, path, method === 'POST' ? {} : undefined)).status).toBe(403)
    }
  })

  test('agents see the dashboard, search and exports, but not taxes and fees or users', async () => {
    expect((await agent.call('GET', '/govt/search?query=nile')).status).toBe(200)
    expect((await agent.call('GET', '/govt/companies')).status).toBe(200)
    expect((await agent.call('GET', '/govt/charges')).status).toBe(403)
    expect((await agent.call('POST', '/govt/charges', {})).status).toBe(403)
    expect((await agent.call('PUT', '/govt/charges/1', {})).status).toBe(403)
    expect((await agent.call('GET', '/govt/users')).status).toBe(403)
    const me = (await agent.call('GET', '/auth/me')).body.user
    expect(me).toMatchObject({ kind: 'govt', company: null, role: { key: 'govt_agent' } })
    expect(me.permissions).toEqual(['govt.dashboard', 'govt.search', 'govt.exports'])
  })
})

describe('dashboard', () => {
  test('revenue is the paid bills in the period', async () => {
    const result = await govt.call('POST', '/govt/dashboard', {
      filters: { range: { preset: '30d' } },
      view: { bucket: null, breakdown: 'route', sort: 'revenue' }
    })
    expect(result.status).toBe(200)
    const from = new Date(result.body.data.from)
    const to = new Date(result.body.data.to)
    const [row] = await getDb()
      .select({ sum: sql<number>`coalesce(sum(${payments.amount}), 0)`.mapWith(Number) })
      .from(payments)
      .where(
        sql`${payments.status} = 'paid' and ${payments.paidAt} >= ${from.toISOString()} and ${payments.paidAt} < ${to.toISOString()}`
      )
    expect(result.body.data.kpis.revenue).toBe(row.sum)
    expect(result.body.data.kpis.revenue).toBeGreaterThan(0)
  })

  test('the daily summary gives the same figures as the paid trips themselves', async () => {
    const ranges = [
      { preset: '7d' },
      { preset: '30d' },
      { preset: '90d' },
      { preset: '12m' },
      { preset: 'ytd' },
      { preset: 'custom', from: '2026-01-10', to: '2026-03-20' }
    ] as const
    for (const range of ranges) {
      for (const breakdown of BREAKDOWNS) {
        const view = { bucket: null, breakdown, sort: 'revenue' as const }
        const fromSummary = await getDashboard({ range }, view)
        const live = await getDashboard({ range }, view, 'live')
        const label = `${range.preset} by ${breakdown}`
        expect(fromSummary.kpis, label).toEqual(live.kpis)
        expect(fromSummary.revenueSeries, label).toEqual(live.revenueSeries)
        expect(fromSummary.byTax, label).toEqual(live.byTax)
        // Cargo shares are fractions summed per day or all at once: equal once rounded, give or
        // take the rounding of a half
        const close = (a: { revenue: number; trips: number }[], b: typeof a): void => {
          expect(a.length, label).toBe(b.length)
          a.forEach((row, i) => {
            expect(Math.abs(row.revenue - b[i].revenue), label).toBeLessThanOrEqual(1)
            expect(row.trips, label).toBe(b[i].trips)
          })
        }
        close(fromSummary.byCargo, live.byCargo)
        const byKey = <T extends { key: string }>(rows: T[]): T[] =>
          [...rows].sort((a, b) => a.key.localeCompare(b.key))
        close(byKey(fromSummary.breakdown), byKey(live.breakdown))
        expect(byKey(fromSummary.breakdown).map((r) => [r.key, r.name, r.originCityId])).toEqual(
          byKey(live.breakdown).map((r) => [r.key, r.name, r.originCityId])
        )
      }
    }
  }, 120_000)

  test('nothing paid after now counts, though it is in today’s summary row', async () => {
    const view = { bucket: null, breakdown: 'route' as const, sort: 'revenue' as const }
    const [paid] = await getDb()
      .select({ id: payments.id, paidAt: payments.paidAt })
      .from(payments)
      .where(eq(payments.status, 'paid'))
      .limit(1)
    const later = new Date(Date.now() + 60_000)
    // Only meaningful while a minute from now is still today
    if (dayOf(later) !== dayOf(new Date())) return
    await getDb().update(payments).set({ paidAt: later }).where(eq(payments.id, paid.id))
    try {
      await rebuildDailyRevenue()
      const fromSummary = await getDashboard({ range: { preset: '7d' } }, view)
      const live = await getDashboard({ range: { preset: '7d' } }, view, 'live')
      expect(fromSummary.kpis.revenue).toBe(live.kpis.revenue)
      expect(fromSummary.revenueSeries).toEqual(live.revenueSeries)
      expect(fromSummary.byTax).toEqual(live.byTax)
    } finally {
      await getDb().update(payments).set({ paidAt: paid.paidAt }).where(eq(payments.id, paid.id))
      await rebuildDailyRevenue()
    }
  })

  test('a stale summary is not read until it has been rebuilt', async () => {
    const view = { bucket: null, breakdown: 'route' as const, sort: 'revenue' as const }
    const before = await getDashboard({ range: { preset: '30d' } }, view)
    await markSummaryStale()
    // A summary that no longer matches the payments: emptied, as if a rebuild had failed midway
    await getDb().execute(sql`delete from daily_revenue`)
    try {
      expect(await isSummaryStale()).toBe(true)
      expect((await getDashboard({ range: { preset: '30d' } }, view)).kpis.revenue).toBe(
        before.kpis.revenue
      )
      // The next startup rebuilds it
      await ensureDemoData()
      expect(await isSummaryStale()).toBe(false)
      expect((await getDashboard({ range: { preset: '30d' } }, view)).kpis.revenue).toBe(
        before.kpis.revenue
      )
    } finally {
      await rebuildDailyRevenue()
    }
  })

  test('bad filters are refused', async () => {
    expect((await govt.call('POST', '/govt/dashboard', { filters: {}, view: {} })).status).toBe(400)
  })
})

describe('search', () => {
  test('pages through every match, newest first', async () => {
    const first = await govt.call('GET', '/govt/search?query=nile&pageSize=25')
    const { total, rows, page } = first.body.data
    expect(page).toBe(1)
    expect(total).toBeGreaterThan(100)
    expect(rows).toHaveLength(25)
    const last = Math.ceil(total / 25)
    const end = await govt.call('GET', `/govt/search?query=nile&pageSize=25&page=${last}`)
    expect(end.body.data.rows).toHaveLength(total - (last - 1) * 25)
    const dates = rows.map((r: { departureAt: number }) => r.departureAt)
    expect(dates).toEqual([...dates].sort((a, b) => b - a))
  })

  test('an empty search is refused', async () => {
    expect((await govt.call('GET', '/govt/search')).body.error).toBe('missing_fields')
  })

  test('a broad search counts up to 1,000, says there are more, and pages no further', async () => {
    const broad = await govt.call('GET', '/govt/search?query=khartoum&pageSize=100')
    expect(broad.body.data).toMatchObject({ total: SEARCH_CAP, more: true })
    const past = await govt.call('GET', '/govt/search?query=khartoum&pageSize=100&page=50')
    expect(past.body.data.page).toBe(SEARCH_CAP / 100)
    expect(past.body.data.rows).toHaveLength(100)
    const narrow = await govt.call('GET', '/govt/search?query=nile&pageSize=25')
    expect(narrow.body.data.more).toBe(false)
  })

  test('finds a trip by each of its numbers', async () => {
    const [trip] = await getDb()
      .select({
        id: manifests.id,
        billId: payments.billId,
        manifestNo: certificates.manifestNo,
        certificateNo: certificates.certificateNo,
        plate: vehicles.plateNumber
      })
      .from(manifests)
      .innerJoin(payments, eq(payments.manifestId, manifests.id))
      .innerJoin(certificates, eq(certificates.manifestId, manifests.id))
      .innerJoin(vehicles, eq(vehicles.id, manifests.vehicleId))
      .where(eq(manifests.category, 'cargo'))
      .limit(1)
    const [bus] = await getDb()
      .select({ id: manifests.id, manifestNo: certificates.manifestNo })
      .from(manifests)
      .innerJoin(certificates, eq(certificates.manifestId, manifests.id))
      .where(eq(manifests.category, 'passenger'))
      .limit(1)
    const found = async (query: string): Promise<number[]> =>
      (
        await govt.call('GET', `/govt/search?query=${encodeURIComponent(query)}&pageSize=100`)
      ).body.data.rows.map((r: { manifestId: number }) => r.manifestId)
    expect(await found(trip.billId)).toEqual([trip.id])
    expect(await found(trip.billId.slice(0, 14))).toContain(trip.id)
    expect(await found(trip.manifestNo!)).toEqual([trip.id])
    expect(await found(trip.certificateNo)).toEqual([trip.id])
    expect(await found(bus.manifestNo!)).toEqual([bus.id])
    expect(await found(`#${trip.id}`)).toEqual([trip.id])
    // The plate's number in Arabic digits
    const digits = trip.plate.split('/')[1]
    const arabic = digits.replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)])
    expect(await found(arabic)).toContain(trip.id)
  })
})

describe('trips and files', () => {
  test("any company's trip opens read-only, and its attachments too", async () => {
    const found = await govt.call('GET', '/govt/search?query=nile&pageSize=25')
    const id = found.body.data.rows[0].manifestId
    const trip = await govt.call('GET', `/govt/trips/${id}`)
    expect(trip.body.data.trip.id).toBe(id)
    expect(trip.body.data.company.name).toBeTruthy()
    expect(trip.body.data.bookedBy.phone).toMatch(/^\+249/)
    expect((await govt.call('GET', '/govt/documents/999999/file')).status).toBe(404)
    // A saved attachment's row without its file is also "not found", never a crash
    const [doc] = await getDb()
      .insert(tripDocuments)
      .values({
        manifestId: id,
        docType: 'packing_list',
        fileName: 'x.pdf',
        storedName: 'missing.pdf',
        size: 1
      })
      .returning()
    expect((await govt.call('GET', `/govt/documents/${doc.id}/file`)).status).toBe(404)
    await getDb().delete(tripDocuments).where(eq(tripDocuments.id, doc.id))
  })
})

describe('taxes and fees', () => {
  test('the admin adds a fee and changes a tax; each change is logged under them', async () => {
    const view = (await govt.call('GET', '/govt/charges')).body.data
    const locality = view.charges.find((c: { code: string }) => c.code === 'locality')
    const updated = await govt.call('PUT', `/govt/charges/${locality.id}`, {
      ...locality,
      cargoValue: 250
    })
    expect(updated.status).toBe(200)
    expect(updated.body.data.history[0]).toMatchObject({
      chargeId: locality.id,
      field: 'cargoValue',
      oldValue: '200',
      newValue: '250',
      changedBy: 'inspector'
    })
    expect(
      (await govt.call('PUT', `/govt/charges/${locality.id}`, { ...locality, cargoValue: 20000 }))
        .body.error
    ).toBe('invalid_tax_rate')
    await govt.call('PUT', `/govt/charges/${locality.id}`, locality)

    const added = await govt.call('POST', '/govt/charges', {
      name: 'Bridge fee',
      nameAr: 'رسوم الجسر',
      kind: 'fixed',
      cargoValue: 300,
      passengerValue: 100,
      active: true
    })
    expect(added.body.data.charges.at(-1)).toMatchObject({ name: 'Bridge fee', builtin: false })
    expect((await govt.call('PUT', '/govt/charges/999999', locality)).status).toBe(404)
  })
})

describe('export', () => {
  const input = {
    filters: { range: { preset: '30d' } },
    dateBasis: 'trip',
    status: 'all',
    datasets: ['trips', 'bills'],
    labels: LABELS
  }

  test('one Excel workbook downloads as is', async () => {
    const result = await govt.call('POST', '/govt/exports', { ...input, formats: ['xlsx'] })
    expect(result.status).toBe(200)
    expect(result.headers.get('content-type')).toContain('spreadsheetml')
    expect(result.headers.get('content-disposition')).toMatch(
      /^attachment; filename="masarat-data-/
    )
    expect(JSON.parse(result.headers.get('x-export-rows') ?? '{}').trips).toBeGreaterThan(0)
    // An xlsx is itself a ZIP: it starts with "PK"
    expect([...new Uint8Array(result.body).slice(0, 2)]).toEqual([0x50, 0x4b])
  })

  test('Excel and CSV together come as one ZIP', async () => {
    const result = await govt.call('POST', '/govt/exports', { ...input, formats: ['xlsx', 'csv'] })
    expect(result.headers.get('content-type')).toBe('application/zip')
    const names = Object.keys(unzipSync(new Uint8Array(result.body))).sort()
    expect(names).toHaveLength(3)
    expect(names.filter((n) => n.endsWith('.csv'))).toHaveLength(2)
    expect(names.filter((n) => n.endsWith('.xlsx'))).toHaveLength(1)
  })

  test('a long export is read in batches, every trip once, in departure order', async () => {
    const all = await govt.call('POST', '/govt/exports', {
      ...input,
      datasets: ['trips', 'taxLines'],
      formats: ['csv']
    })
    const before = exportLimits.batch
    exportLimits.batch = 7
    try {
      const batched = await govt.call('POST', '/govt/exports', {
        ...input,
        datasets: ['trips', 'taxLines'],
        formats: ['csv']
      })
      const files = (body: ArrayBuffer): Record<string, string> =>
        Object.fromEntries(
          Object.entries(unzipSync(new Uint8Array(body))).map(([name, bytes]) => [
            name,
            strFromU8(bytes)
          ])
        )
      // The same files, byte for byte, whatever the batch size
      expect(files(batched.body)).toEqual(files(all.body))
      const trips = Object.entries(files(batched.body)).find(([n]) => n.includes('-trips-'))![1]
      const ids = trips
        .trim()
        .split('\r\n')
        .slice(1)
        .map((line) => Number(line.split(',')[0]))
      expect(ids.length).toBeGreaterThan(7 * 3)
      expect(new Set(ids).size).toBe(ids.length)
      expect(JSON.parse(batched.headers.get('x-export-rows') ?? '{}').trips).toBe(ids.length)
    } finally {
      exportLimits.batch = before
    }
  })

  test('an Excel sheet past its row limit is refused with the counts, CSV is not', async () => {
    const before = exportLimits.excelRows
    exportLimits.excelRows = 5
    try {
      const excel = await govt.call('POST', '/govt/exports', { ...input, formats: ['xlsx'] })
      expect(excel.status).toBe(413)
      expect(excel.body.error).toBe('export_too_large_for_excel')
      expect(excel.body.rows.trips).toBeGreaterThan(5)
      const csv = await govt.call('POST', '/govt/exports', { ...input, formats: ['csv'] })
      expect(csv.status).toBe(200)
    } finally {
      exportLimits.excelRows = before
    }
  })

  test('an export too big for one ZIP is refused; a single file still downloads', async () => {
    const before = exportLimits.zipBytes
    exportLimits.zipBytes = 10
    try {
      const both = await govt.call('POST', '/govt/exports', { ...input, formats: ['xlsx', 'csv'] })
      expect(both.status).toBe(413)
      expect(both.body.error).toBe('export_too_large')
      const one = await govt.call('POST', '/govt/exports', {
        ...input,
        datasets: ['trips'],
        formats: ['csv']
      })
      expect(one.status).toBe(200)
      expect(one.headers.get('content-type')).toContain('text/csv')
    } finally {
      exportLimits.zipBytes = before
    }
  })

  test('malformed options are refused', async () => {
    const result = await govt.call('POST', '/govt/exports', {
      ...input,
      formats: ['xlsx'],
      labels: {}
    })
    expect(result.status).toBe(400)
  })
})

describe('demo regenerate', () => {
  test('refused outside demo mode', async () => {
    const { config } = await import('../src/config')
    config.demoMode = false
    try {
      expect((await govt.call('POST', '/govt/demo/regenerate')).status).toBe(403)
    } finally {
      config.demoMode = true
    }
  })
})
