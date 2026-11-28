// The export queue (services/exportQueue.ts) and the worker's side (services/exportWorker.ts): the
// API queues, the worker prepares at most one export per active government admin or supervisor at
// a time, one export per account, only its account sees it, cancelling, a dead worker's lease, and
// the expired files' sweep
import { beforeAll, describe, expect, test } from 'bun:test'
import { config } from '../src/config'
import {
  claimExport,
  exportConcurrency,
  exportKeys,
  finishExport,
  queueExport
} from '../src/services/exportQueue'
import {
  drainExports,
  EXPORT_LEASE_MS,
  runExport,
  startQueuedExports,
  sweepExportFiles
} from '../src/services/exportWorker'
import { getRedis } from '../src/services/redis'
import { objectStore } from '../src/services/storage'
import { createUser, resetData, signedIn, type Browser } from './helpers'

const INPUT = {
  filters: { range: { preset: '30d' } },
  dateBasis: 'trip',
  status: 'all',
  datasets: ['trips'],
  formats: ['csv'],
  labels: { columns: {}, sheets: {}, values: {} }
}

let admin: Browser
let supervisor: Browser
let agent: Browser
let otherAgent: Browser

beforeAll(async () => {
  await resetData()
  await getRedis().send('FLUSHDB', [])
  admin = (await signedIn('exp.admin', 'govt_admin')).b
  supervisor = (await signedIn('exp.supervisor', 'govt_supervisor')).b
  agent = (await signedIn('exp.agent', 'govt_agent')).b
  otherAgent = (await signedIn('exp.agent2', 'govt_agent')).b
  // A disabled supervisor doesn't count towards the limit
  await createUser('exp.gone', 'govt_supervisor', { disabledAt: new Date() })
}, 60_000)

describe('queueing and following an export', () => {
  test('queued, prepared by the worker, then downloaded; the latest is kept for the dialog', async () => {
    const queued = await agent.call('POST', '/govt/exports', INPUT)
    expect(queued.status).toBe(202)
    expect(queued.body.data).toMatchObject({ status: 'queued', ahead: 0, fileName: null })
    const id = queued.body.data.id
    expect((await agent.call('GET', '/govt/exports/current')).body.data.id).toBe(id)

    await drainExports()
    const done = (await agent.call('GET', `/govt/exports/${id}`)).body.data
    expect(done.status).toBe('done')
    expect(done.fileName).toMatch(/^masarat-trips-.*\.csv$/)
    expect(done.startedAt).toBeGreaterThanOrEqual(done.createdAt)

    const file = await agent.call('GET', `/govt/exports/${id}/file`)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toContain('text/csv')
    expect(JSON.parse(file.headers.get('x-export-rows') ?? '{}')).toEqual({ trips: 0 })
  })

  test('two exports started at once for one account: one is queued, the other refused', async () => {
    const ownerId = (await signedIn('exp.race', 'govt_agent')).id
    const results = await Promise.all(
      Array.from({ length: 5 }, () => queueExport(ownerId, INPUT as never))
    )
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok && r.error === 'export_in_progress')).toHaveLength(4)
    expect(await getRedis().send('LLEN', [exportKeys.queue])).toBe(1)
    await drainExports()
  })

  test('one export at a time per account', async () => {
    const first = await agent.call('POST', '/govt/exports', INPUT)
    expect(first.status).toBe(202)
    const second = await agent.call('POST', '/govt/exports', INPUT)
    expect(second.status).toBe(409)
    expect(second.body.error).toBe('export_in_progress')
    // Not ready yet
    expect((await agent.call('GET', `/govt/exports/${first.body.data.id}/file`)).body.error).toBe(
      'export_not_ready'
    )
    await drainExports()
    expect((await agent.call('POST', '/govt/exports', INPUT)).status).toBe(202)
    await drainExports()
  })

  test("only its account sees, downloads or cancels an export; companies can't export", async () => {
    const queued = await agent.call('POST', '/govt/exports', INPUT)
    const id = queued.body.data.id
    for (const [method, path] of [
      ['GET', `/govt/exports/${id}`],
      ['GET', `/govt/exports/${id}/file`],
      ['DELETE', `/govt/exports/${id}`]
    ]) {
      expect((await otherAgent.call(method, path)).status).toBe(404)
    }
    expect((await otherAgent.call('GET', '/govt/exports/current')).body.data).toBeNull()
    expect((await agent.call('GET', '/govt/exports/not-an-id')).status).toBe(404)
    const owner = (await signedIn('exp.owner', 'company_admin')).b
    expect((await owner.call('POST', '/govt/exports', INPUT)).status).toBe(403)
    await drainExports()
  })
})

describe('how many at once', () => {
  test('one per active government admin or supervisor; EXPORT_CONCURRENCY replaces it', async () => {
    expect(await exportConcurrency(null)).toBe(2)
    expect(await exportConcurrency(7)).toBe(7)
  })

  test('past the limit, exports wait in line, first come first served', async () => {
    const before = config.exportConcurrency
    config.exportConcurrency = null
    try {
      const ids: string[] = []
      for (const b of [admin, supervisor, agent, otherAgent]) {
        ids.push((await b.call('POST', '/govt/exports', INPUT)).body.data.id)
      }
      expect((await otherAgent.call('GET', `/govt/exports/${ids[3]}`)).body.data.ahead).toBe(3)

      // Two are prepared at once (claimed: each holds its place until it's built); the others wait
      const limit = await exportConcurrency(config.exportConcurrency)
      const first = await claimExport(limit, EXPORT_LEASE_MS)
      const second = await claimExport(limit, EXPORT_LEASE_MS)
      expect([first.job?.id, second.job?.id]).toEqual([ids[0], ids[1]])
      expect((await admin.call('GET', `/govt/exports/${ids[0]}`)).body.data.status).toBe('running')
      const third = (await agent.call('GET', `/govt/exports/${ids[2]}`)).body.data
      expect(third).toMatchObject({ status: 'queued', ahead: 0 })
      expect((await otherAgent.call('GET', `/govt/exports/${ids[3]}`)).body.data.ahead).toBe(1)
      // No room until one finishes
      expect((await claimExport(limit, EXPORT_LEASE_MS)).job).toBeNull()
      expect(await startQueuedExports()).toHaveLength(0)

      await Promise.all([runExport(first.job!), runExport(second.job!)])
      await drainExports()
      for (const [b, id] of [
        [admin, ids[0]],
        [supervisor, ids[1]],
        [agent, ids[2]],
        [otherAgent, ids[3]]
      ] as const) {
        expect((await b.call('GET', `/govt/exports/${id}`)).body.data.status).toBe('done')
      }
    } finally {
      config.exportConcurrency = before
    }
  })
})

describe('cancelling and failures', () => {
  test('a queued export leaves the line and is never prepared', async () => {
    const id = (await agent.call('POST', '/govt/exports', INPUT)).body.data.id
    const cancelled = await agent.call('DELETE', `/govt/exports/${id}`)
    expect(cancelled.body.data.status).toBe('cancelled')
    expect(await getRedis().send('LLEN', [exportKeys.queue])).toBe(0)
    await drainExports()
    expect((await agent.call('GET', `/govt/exports/${id}`)).body.data.status).toBe('cancelled')
    // The account may export again at once
    expect((await agent.call('POST', '/govt/exports', INPUT)).status).toBe(202)
    await drainExports()
  })

  test('an export cancelled while being prepared is thrown away', async () => {
    const id = (await agent.call('POST', '/govt/exports', INPUT)).body.data.id
    const { job } = await claimExport(2, EXPORT_LEASE_MS)
    expect(job?.id).toBe(id)
    await agent.call('DELETE', `/govt/exports/${id}`)
    await runExport(job!)
    expect((await agent.call('GET', `/govt/exports/${id}`)).body.data).toMatchObject({
      status: 'cancelled',
      fileName: null
    })
    expect(await objectStore.list(`exports/${id}/`)).toEqual([])
    expect(await getRedis().send('ZCARD', [exportKeys.running])).toBe(0)
  })

  test('an export cancelled while its file uploads stays cancelled', async () => {
    const id = (await agent.call('POST', '/govt/exports', INPUT)).body.data.id
    const { job } = await claimExport(2, EXPORT_LEASE_MS)
    expect(job?.id).toBe(id)
    // The worker built the file and is uploading it when the user cancels
    await agent.call('DELETE', `/govt/exports/${id}`)
    expect(await finishExport(job!, { file: { key: 'k', name: 'f.csv' }, rows: {} })).toBe(false)
    expect((await agent.call('GET', `/govt/exports/${id}`)).body.data).toMatchObject({
      status: 'cancelled',
      fileName: null
    })
    expect((await agent.call('GET', `/govt/exports/${id}/file`)).body.error).toBe(
      'export_not_ready'
    )
    expect(await getRedis().send('ZCARD', [exportKeys.running])).toBe(0)
  })

  test("a worker that dies loses its export once the lease runs out: it's marked failed", async () => {
    const id = (await agent.call('POST', '/govt/exports', INPUT)).body.data.id
    // Claimed by a worker that then never renews its lease
    const { job } = await claimExport(2, EXPORT_LEASE_MS)
    expect(job?.id).toBe(id)
    const later = await claimExport(2, EXPORT_LEASE_MS, Date.now() + EXPORT_LEASE_MS + 1)
    expect(later.expired).toEqual([id])
    expect((await agent.call('GET', `/govt/exports/${id}`)).body.data).toMatchObject({
      status: 'failed',
      error: 'export_failed'
    })
    // Its account isn't stuck with it
    expect((await agent.call('POST', '/govt/exports', INPUT)).status).toBe(202)
    await drainExports()
  })

  test('a worker that dies between claiming an export and starting it: the export fails', async () => {
    const id = (await agent.call('POST', '/govt/exports', INPUT)).body.data.id
    // As the claim script leaves it: out of the line, among those being prepared, still "queued"
    await getRedis().send('LREM', [exportKeys.queue, '1', id])
    await getRedis().send('ZADD', [exportKeys.running, String(Date.now() - 1), id])
    const later = await claimExport(2, EXPORT_LEASE_MS)
    expect(later.expired).toEqual([id])
    expect((await agent.call('GET', `/govt/exports/${id}`)).body.data.status).toBe('failed')
    // Its account isn't stuck with it
    expect((await agent.call('POST', '/govt/exports', INPUT)).status).toBe(202)
    await drainExports()
  })

  test('the size limits fail the export with the counts', async () => {
    const { exportLimits } = await import('../src/services/exports')
    const before = exportLimits.zipBytes
    exportLimits.zipBytes = 1
    try {
      const id = (await agent.call('POST', '/govt/exports', { ...INPUT, formats: ['xlsx', 'csv'] }))
        .body.data.id
      await drainExports()
      expect((await agent.call('GET', `/govt/exports/${id}`)).body.data).toMatchObject({
        status: 'failed',
        error: 'export_too_large',
        rows: { trips: 0 }
      })
    } finally {
      exportLimits.zipBytes = before
    }
  })

  test('files older than an hour are swept from the bucket', async () => {
    const id = (await agent.call('POST', '/govt/exports', INPUT)).body.data.id
    await drainExports()
    expect(await objectStore.list(`exports/${id}/`)).toHaveLength(1)
    // A fresh file stays (the test bucket may hold older runs' files, which go)
    await sweepExportFiles(60 * 60 * 1000)
    expect(await objectStore.list(`exports/${id}/`)).toHaveLength(1)
    expect(await sweepExportFiles(60 * 60 * 1000, Date.now() + 2 * 60 * 60 * 1000)).toBeGreaterThan(
      0
    )
    expect(await objectStore.list(`exports/${id}/`)).toEqual([])
    expect((await agent.call('GET', `/govt/exports/${id}/file`)).status).toBe(404)
  })
})
