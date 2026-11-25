// What every deployment relies on: production configuration, readiness, security headers, request
// ids in replies and logs, the least-privileged database role, and the jobs' single-instance lock.
import { describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import { app } from '../src/app'
import { ConfigError, buildConfig } from '../src/config'
import { getDb } from '../src/db'
import { checkDbRole } from '../src/services/dbRole'
import { addReadinessCheck } from '../src/services/health'
import { runJob } from '../src/services/jobs'

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
