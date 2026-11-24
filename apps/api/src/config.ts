// The API's settings, from the environment (Bun loads apps/api/.env). The defaults suit local
// development (run from apps/api); see .env.example.
import { resolve } from 'path'

// Dates are Sudan's: a trip date is local midnight, and months group in local time. The host's own
// zone must not matter, so the process and the database session both use this one.
const timeZone = process.env.TZ || 'Africa/Khartoum'
process.env.TZ = timeZone

const url = (name: string, fallback: string): string =>
  (process.env[name] ?? fallback).replace(/\/+$/, '')

// development or production. Production refuses what only suits development (the formula pricing,
// see services/pricing.ts).
const APP_ENVS = ['development', 'production'] as const
type AppEnv = (typeof APP_ENVS)[number]
const appEnv = (process.env.APP_ENV || 'development') as AppEnv
if (!APP_ENVS.includes(appEnv)) throw new Error(`APP_ENV must be one of ${APP_ENVS.join(', ')}`)

const siteUrl = url('SITE_URL', 'http://localhost:5175')
const ownerUrl = url('OWNER_URL', 'http://localhost:5173')
const govtUrl = url('GOVT_URL', 'http://localhost:5174')

export const config = {
  appEnv,
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://masarat:masarat@localhost:5433/masarat',
  // Connections the API keeps open to Postgres (postgres.js's default is 10)
  dbPoolMax: Number(process.env.DB_POOL_MAX) || 10,
  migrationsFolder: resolve(import.meta.dir, '..', 'drizzle'),
  // Trip attachments: documents/<manifest id>/ and documents/staging/
  storageDir: resolve(process.env.STORAGE_DIR ?? 'storage'),
  // Seeds the demo fleet companies and enables the demo-only actions; off in production
  demoMode: process.env.DEMO_MODE === 'true',
  timeZone,

  // The three web apps: masarat.com (login), owner.masarat.com and govt.masarat.com. Only these
  // origins may call the API with the session cookie.
  siteUrl,
  ownerUrl,
  govtUrl,
  allowedOrigins: [siteUrl, ownerUrl, govtUrl].map((u) => new URL(u).origin),
  // The session cookie's Domain: ".masarat.com" in production, so every subdomain shares it.
  // Unset in development: a host-only cookie on localhost is shared across ports.
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  // Secure cookies whenever the site is served over HTTPS
  cookieSecure: siteUrl.startsWith('https://'),
  // Behind a reverse proxy, the client's IP comes from X-Forwarded-For
  trustProxy: process.env.TRUST_PROXY === 'true'
}
