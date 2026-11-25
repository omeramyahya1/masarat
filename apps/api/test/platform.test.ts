// What every deployment relies on: production configuration, readiness, security headers, request
// ids in replies and logs, the least-privileged database role, and the jobs' single-instance lock.
import { beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { app } from '../src/app'
import { ConfigError, buildConfig } from '../src/config'
import { getDb } from '../src/db'
import { checkDbRole } from '../src/services/dbRole'
import { addReadinessCheck } from '../src/services/health'
import { runJob } from '../src/services/jobs'
import { resetData, signedIn, type Browser } from './helpers'

const PRODUCTION = {
  APP_ENV: 'production',
  DATABASE_URL: 'postgres://masarat_app:secret@db:5432/masarat',
  MIGRATION_DATABASE_URL: 'postgres://masarat:other@db:5432/masarat',
  SITE_URL: 'https://masarat.com',
  OWNER_URL: 'https://owner.masarat.com',
  GOVT_URL: 'https://govt.masarat.com',
  COOKIE_DOMAIN: '.masarat.com',
  REDIS_URL: 'redis://redis:6379',
  S3_ENDPOINT: 'https://storage.internal',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret'
}

const productionError = (env: Record<string, string | undefined>): string => {
  try {
    buildConfig(env)
    return ''
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError)
    return (err as Error).message
  }
}

describe('production configuration', () => {
  test('a complete production configuration is accepted', () => {
    const config = buildConfig(PRODUCTION)
    expect(config.production).toBe(true)
    expect(config.cookieSecure).toBe(true)
    expect(config.log.pretty).toBe(false)
  })

  test('nothing falls back to a development default', () => {
    for (const name of Object.keys(PRODUCTION).filter((k) => k !== 'APP_ENV')) {
      expect(productionError({ ...PRODUCTION, [name]: undefined })).toContain(name)
    }
  })

  test('demo mode, plain http and the owner role are refused', () => {
    expect(productionError({ ...PRODUCTION, DEMO_MODE: 'true' })).toContain('DEMO_MODE')
    expect(productionError({ ...PRODUCTION, SITE_URL: 'http://masarat.com' })).toContain('https')
    expect(
      productionError({ ...PRODUCTION, DATABASE_URL: PRODUCTION.MIGRATION_DATABASE_URL })
    ).toContain('app role')
  })

  test('development keeps its local defaults', () => {
    const config = buildConfig({})
    expect(config.production).toBe(false)
    expect(config.databaseUrl).toContain('masarat_app')
  })
})

describe('health', () => {
  test('ready while every dependency answers, 503 when one does not', async () => {
    const ready = await app.request('/health/ready')
    expect(ready.status).toBe(200)
    expect((await ready.json()).data.checks.postgres).toBe('ok')

    addReadinessCheck('broken', async () => {
      throw new Error('down')
    })
    const down = await app.request('/health/ready')
    expect(down.status).toBe(503)
    expect((await down.json()).data.checks).toMatchObject({ postgres: 'ok', broken: 'failed' })
    addReadinessCheck('broken', async () => {})
  })
})

describe('responses', () => {
  test('every response has the security headers and a request id', async () => {
    const res = await app.request('/health')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('a well-formed request id from the proxy is kept; anything else is replaced', async () => {
    const kept = await app.request('/health', { headers: { 'X-Request-Id': 'proxy-1234abcd' } })
    expect(kept.headers.get('x-request-id')).toBe('proxy-1234abcd')
    const replaced = await app.request('/health', { headers: { 'X-Request-Id': 'bad id\n' } })
    expect(replaced.headers.get('x-request-id')).not.toBe('bad id\n')
  })
})

describe('database role', () => {
  test('the API connects as masarat_app, which cannot change the schema', async () => {
    const check = await checkDbRole()
    expect(check).toEqual({ role: 'masarat_app', problems: [] })
    let caught: unknown = null
    try {
      await getDb().execute(sql`create table not_allowed (id int)`)
    } catch (err) {
      caught = err
    }
    expect(String((caught as { cause?: unknown })?.cause ?? caught)).toContain('permission denied')
  })
})

describe('jobs', () => {
  test('an exclusive job runs on one instance at a time', async () => {
    let runs = 0
    let release: () => void = () => {}
    const blocker = new Promise<void>((resolve) => (release = resolve))
    const job = {
      name: 'test.exclusive',
      everyMs: 60_000,
      exclusive: true,
      run: async () => {
        runs++
        await blocker
      }
    }
    const first = runJob(job)
    // Give the first run time to take the lock
    await Bun.sleep(100)
    await runJob(job)
    release()
    await first
    expect(runs).toBe(1)
  })
})

describe('request validation', () => {
  let owner: Browser
  let govt: Browser
  beforeAll(async () => {
    await resetData()
    owner = (await signedIn('validation.owner', 'company_admin')).b
    govt = (await signedIn('validation.govt', 'govt_agent')).b
  })

  test('a body of the wrong shape is refused before any service runs', async () => {
    const wrongType = await owner.call('POST', '/vehicles', {
      plateNumber: 'KH 1/1',
      registrationNo: 'R-1',
      vehicleType: 'lorry',
      capacity: 'ten',
      capacityUnit: 'ton'
    })
    expect(wrongType).toMatchObject({ status: 400, body: { ok: false, error: 'invalid_request' } })
    const unknownValue = await owner.call('POST', '/drivers', { name: 'x'.repeat(201), phone: '1' })
    expect(unknownValue.body.error).toBe('invalid_request')
    // Some routes keep the code their portal already shows
    expect((await govt.call('POST', '/govt/dashboard', { filters: {} })).body.error).toBe(
      'missing_fields'
    )
    expect(
      (await owner.call('POST', '/roles', { name: 'x', scope: 'galaxy', permissions: [] })).body
        .error
    ).toBe('invalid_role')
  })

  test('unknown fields are dropped', async () => {
    const created = await owner.call('POST', '/drivers', {
      name: 'Driver One',
      phone: '0912000111',
      companyId: 999
    })
    expect(created.status).toBe(200)
    expect(created.body.data.name).toBe('Driver One')
  })

  test('query strings fall back to defaults instead of failing', async () => {
    const page = await owner.call('GET', '/trips?page=-3&pageSize=7&sort=nonsense&status=lost')
    expect(page.status).toBe(200)
    expect(page.body.data).toMatchObject({ page: 1, pageSize: 50 })
  })
})

describe('OpenAPI', () => {
  test('development serves the API description, built from the schemas', async () => {
    const res = await app.request('/openapi.json')
    expect(res.status).toBe(200)
    const spec = await res.json()
    expect(spec.openapi).toBe('3.1.0')
    expect(Object.keys(spec.paths).length).toBeGreaterThan(40)
    const createVehicle = spec.paths['/vehicles'].post
    expect(createVehicle.summary).toBe('Add a vehicle')
    expect(createVehicle.requestBody.content['application/json'].schema.properties).toHaveProperty(
      'plateNumber'
    )
  })
})

describe('shared state: object storage and Redis', () => {
  test('attachments live in the bucket; saving keeps the key, the sweep removes unsaved uploads', async () => {
    const { stageDocument, findStaged, consumeStaged, sweepUnusedUploads, uploadPrefix } =
      await import('../src/services/documents')
    const { objectStore } = await import('../src/services/storage')
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])

    const staged = await stageDocument(42, 'commercial_invoice', 'invoice.pdf', pdf)
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    const found = await findStaged(42, staged.data.token)
    expect(found?.storedName).toStartWith(uploadPrefix(new Date()))
    expect(await objectStore.exists(found!.storedName)).toBe(true)
    // Only the uploader can use the token, and only until a trip consumes it
    expect(await findStaged(43, staged.data.token)).toBeUndefined()
    await consumeStaged([found!])
    expect(await findStaged(42, staged.data.token)).toBeUndefined()

    // An upload of two days ago that no trip uses goes; the sweep looks at that day only
    const old = new Date()
    old.setDate(old.getDate() - 2)
    const orphan = `${uploadPrefix(old)}${'a'.repeat(32)}.pdf`
    await objectStore.put(orphan, pdf, 'application/pdf')
    expect(await sweepUnusedUploads()).toBeGreaterThanOrEqual(1)
    expect(await objectStore.exists(orphan)).toBe(false)
    expect(await objectStore.exists(found!.storedName)).toBe(true)
    await objectStore.delete([found!.storedName])
  })

  test('the verify page limit is counted in Redis, so every API instance shares it', async () => {
    const { getRedis } = await import('../src/services/redis')
    // The window starts clean, and is left clean for the other test files
    const clear = async (): Promise<void> => {
      const keys = (await getRedis().send('KEYS', ['rate:verify:*'])) as string[]
      if (keys.length) await getRedis().del(...keys)
    }
    await clear()
    try {
      const statuses: number[] = []
      for (let i = 0; i < 61; i++) {
        statuses.push((await app.request('/verify/' + '0'.repeat(32))).status)
      }
      expect(statuses.slice(0, 60).every((s) => s !== 429)).toBe(true)
      expect(statuses[60]).toBe(429)
    } finally {
      await clear()
    }
  })
})
