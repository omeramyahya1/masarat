// Runs before the tests: creates the masarat_test database next to the dev one (if missing),
// points the API at it, applies the migrations as the owner, and lets the API's least-privileged
// role log in, so the tests run with the rights production has. The tests clear it as they need.
import postgres from 'postgres'

const ownerUrl =
  process.env.MIGRATION_DATABASE_URL ?? 'postgres://masarat:masarat@localhost:5433/masarat'
const testOwnerUrl = process.env.TEST_DATABASE_URL ?? ownerUrl.replace(/\/[^/]+$/, '/masarat_test')
const testDb = new URL(testOwnerUrl).pathname.slice(1)
const appUrl = new URL(testOwnerUrl)
appUrl.username = 'masarat_app'
appUrl.password = 'masarat_app'

const admin = postgres(ownerUrl, { onnotice: () => {} })
const [exists] = await admin`select 1 from pg_database where datname = ${testDb}`
if (!exists) await admin.unsafe(`create database "${testDb}"`)
await admin.end()

process.env.MIGRATION_DATABASE_URL = testOwnerUrl
process.env.DATABASE_URL = appUrl.toString()
process.env.DEMO_MODE = 'true'
// Every dashboard computed afresh (the cache has its own test)
process.env.DASHBOARD_CACHE_S = '0'
process.env.STORAGE_DIR = `${import.meta.dir}/.storage`
// Attachments go to the tests' own bucket (compose.yaml creates it)
process.env.S3_BUCKET = process.env.TEST_S3_BUCKET ?? 'masarat-test'

const { migrate } = await import('drizzle-orm/postgres-js/migrator')
const { openUnlimitedDb } = await import('../src/db')
const { enableDevAppRole } = await import('../src/db/devAppRole')
const { config } = await import('../src/config')
const migration = openUnlimitedDb()
await migrate(migration.db, { migrationsFolder: config.migrationsFolder })
await enableDevAppRole(migration.db)
await migration.close()
