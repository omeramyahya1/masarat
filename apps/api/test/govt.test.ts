// The government portal's routes: access, dashboard, paged search, read-only trips and their
// files, tax settings, the data export (one file or a ZIP), and the demo regenerate
import { beforeAll, describe, expect, test } from 'bun:test'
import { unzipSync } from 'fflate'
import { ensureDemoData } from '../src/services/demoData'
import { getDb, payments, tripDocuments } from '../src/db'
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
      ['GET', '/govt/tax-settings'],
      ['POST', '/govt/exports']
    ]) {
      expect((await owner.call(method, path, method === 'POST' ? {} : undefined)).status).toBe(403)
    }
  })

  test('agents see the dashboard, search and exports, but not taxes and fees or users', async () => {
    expect((await agent.call('GET', '/govt/search?query=nile')).status).toBe(200)
    expect((await agent.call('GET', '/govt/companies')).status).toBe(200)
    expect((await agent.call('GET', '/govt/tax-settings')).status).toBe(403)
    expect((await agent.call('PUT', '/govt/tax-settings', { rates: {} })).status).toBe(403)
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
    const dates = rows.map((r: { tripDate: number }) => r.tripDate)
    expect(dates).toEqual([...dates].sort((a, b) => b - a))
  })

  test('an empty search is refused', async () => {
    expect((await govt.call('GET', '/govt/search')).body.error).toBe('missing_fields')
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

describe('tax settings', () => {
  test('a change is logged under the signed-in user', async () => {
    const updated = await govt.call('PUT', '/govt/tax-settings', { locality: 250 })
    expect(updated.status).toBe(200)
    const change = updated.body.data.history[0]
    expect(change).toMatchObject({
      code: 'locality',
      oldValue: 200,
      newValue: 250,
      changedBy: 'inspector'
    })
    expect((await govt.call('PUT', '/govt/tax-settings', { locality: 20000 })).body.error).toBe(
      'invalid_tax_rate'
    )
    await govt.call('PUT', '/govt/tax-settings', { locality: 200 })
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
