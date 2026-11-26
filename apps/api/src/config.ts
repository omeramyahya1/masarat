// The API's settings, from the environment (Bun loads apps/api/.env). The defaults suit local
// development (run from apps/api); see .env.example. In production nothing that matters falls
// back to a development default: a missing setting stops the API at startup.
import { resolve } from 'path'

// Dates are Sudan's: a trip date is local midnight, and months group in local time. The host's own
// zone must not matter, so the process and the database session both use this one.
const timeZone = process.env.TZ || 'Africa/Khartoum'
process.env.TZ = timeZone

// development or production. Production refuses what only suits development: the formula pricing
// (services/pricing.ts), demo mode, and any setting left to its local default.
const APP_ENVS = ['development', 'production'] as const
export type AppEnvName = (typeof APP_ENVS)[number]

type Env = Record<string, string | undefined>

// Local development's services (compose.yaml)
const DEV = {
  databaseUrl: 'postgres://masarat_app:masarat_app@localhost:5433/masarat',
  migrationDatabaseUrl: 'postgres://masarat:masarat@localhost:5433/masarat',
  redisUrl: 'redis://localhost:6380',
  s3Endpoint: 'http://localhost:9000',
  s3AccessKeyId: 'masarat',
  s3SecretAccessKey: 'masarat-dev-secret'
}

export class ConfigError extends Error {}

// The settings for an environment; throws ConfigError when production is missing something. Its
// type is what it returns (Config, below).
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function buildConfig(env: Env) {
  const appEnv = (env.APP_ENV || 'development') as AppEnvName
  if (!APP_ENVS.includes(appEnv))
    throw new ConfigError(`APP_ENV must be one of ${APP_ENVS.join(', ')}`)
  const production = appEnv === 'production'
  const missing: string[] = []

  // A setting production must give; development falls back to its local value
  const required = (name: string, fallback: string): string => {
    const value = env[name]?.trim()
    if (value) return value
    if (production) missing.push(name)
    return fallback
  }
  const url = (name: string, fallback: string): string =>
    required(name, fallback).replace(/\/+$/, '')
  // A positive number from the environment, or the default
  const positiveNumber = (name: string, fallback: number): number => {
    const value = Number(env[name])
    return Number.isFinite(value) && value > 0 ? value : fallback
  }

  const siteUrl = url('SITE_URL', 'http://localhost:5175')
  const ownerUrl = url('OWNER_URL', 'http://localhost:5173')
  const govtUrl = url('GOVT_URL', 'http://localhost:5174')
  const demoMode = env.DEMO_MODE === 'true'

  const config = {
    appEnv,
    production,
    port: Number(env.PORT ?? 3000),
    // The API connects as the least-privileged role (masarat_app: reads and writes rows, never
    // changes the schema); migrations, seeding and the tests' setup as the owner
    databaseUrl: required('DATABASE_URL', DEV.databaseUrl),
    migrationDatabaseUrl: required('MIGRATION_DATABASE_URL', DEV.migrationDatabaseUrl),
    // Connections the API keeps open to Postgres (postgres.js's default is 10)
    dbPoolMax: Number(env.DB_POOL_MAX) || 10,
    // Time limits. Postgres stops an API query after STATEMENT_TIMEOUT_MS; an export's queries get
    // EXPORT_STATEMENT_TIMEOUT_MS. Bun gives up on a request that sends nothing for
    // REQUEST_TIMEOUT_S (at most 255). Migrations and seeding have no limit.
    statementTimeoutMs: positiveNumber('STATEMENT_TIMEOUT_MS', 15_000),
    exportStatementTimeoutMs: positiveNumber('EXPORT_STATEMENT_TIMEOUT_MS', 120_000),
    requestTimeoutS: Math.min(255, positiveNumber('REQUEST_TIMEOUT_S', 30)),
    // How long a stopping API waits for the requests in flight
    shutdownGraceMs: positiveNumber('SHUTDOWN_GRACE_MS', 25_000),
    migrationsFolder: resolve(import.meta.dir, '..', 'drizzle'),
    // Local scratch space: exports being built (each within its own request)
    storageDir: resolve(env.STORAGE_DIR ?? 'storage'),
    // Shared state every API instance sees: upload staging and the public routes' rate limits
    redisUrl: required('REDIS_URL', DEV.redisUrl),
    // Trip attachments, in S3-compatible object storage (MinIO)
    s3: {
      endpoint: url('S3_ENDPOINT', DEV.s3Endpoint),
      bucket: env.S3_BUCKET || 'masarat-documents',
      region: env.S3_REGION || 'us-east-1',
      accessKeyId: required('S3_ACCESS_KEY_ID', DEV.s3AccessKeyId),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY', DEV.s3SecretAccessKey)
    },
    // Logs: JSON lines on stdout and in daily files under LOG_DIR, deleted after LOG_RETENTION_DAYS
    log: {
      level: env.LOG_LEVEL || (production ? 'info' : 'debug'),
      dir: env.LOG_DIR === '' ? null : resolve(env.LOG_DIR ?? 'logs'),
      retentionDays: positiveNumber('LOG_RETENTION_DAYS', 7),
      // Human-readable console output (development); production always writes JSON
      pretty: !production && env.LOG_PRETTY !== 'false'
    },
    // Trips stay in the live tables this many days after departure, then move to the archive
    hotDays: positiveNumber('HOT_DAYS', 30),
    // Checks of the public verify page per IP per minute (shared by the instances through Redis)
    verifyRateLimit: positiveNumber('VERIFY_RATE_LIMIT', 60),
    // How long a computed government dashboard is reused (Redis); 0 computes every visit
    dashboardCacheS: env.DASHBOARD_CACHE_S === '0' ? 0 : positiveNumber('DASHBOARD_CACHE_S', 60),
    // Seeds the demo fleet companies and enables the demo-only actions; never in production
    demoMode,
    timeZone,

    // The three web apps: masarat.com (login), owner.masarat.com and govt.masarat.com. Only these
    // origins may call the API with the session cookie.
    siteUrl,
    ownerUrl,
    govtUrl,
    allowedOrigins: [siteUrl, ownerUrl, govtUrl].map((u) => new URL(u).origin),
    // The session cookie's Domain: ".masarat.com" in production, so every subdomain shares it.
    // Unset in development: a host-only cookie on localhost is shared across ports.
    cookieDomain: (production ? required('COOKIE_DOMAIN', '') : env.COOKIE_DOMAIN) || undefined,
    // Secure cookies whenever the site is served over HTTPS
    cookieSecure: siteUrl.startsWith('https://'),
    // Behind a reverse proxy, the client's IP comes from X-Forwarded-For
    trustProxy: env.TRUST_PROXY === 'true'
  }

  if (production) {
    const problems: string[] = []
    if (missing.length) problems.push(`missing ${missing.join(', ')}`)
    if (demoMode) problems.push('DEMO_MODE must be off')
    if (!siteUrl.startsWith('https://')) problems.push('SITE_URL must use https')
    if (config.databaseUrl === config.migrationDatabaseUrl)
      problems.push('DATABASE_URL must be the app role, not the owner (MIGRATION_DATABASE_URL)')
    if (problems.length) throw new ConfigError(`Production configuration: ${problems.join('; ')}`)
  }
  return config
}

export type Config = ReturnType<typeof buildConfig>

export const config: Config = buildConfig(process.env)
