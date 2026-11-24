// Runs before the tests: creates the masarat_test database next to the dev one (if missing),
// points the API at it and applies the migrations. The tests clear it as they need.
import postgres from 'postgres'

const devUrl = process.env.DATABASE_URL ?? 'postgres://masarat:masarat@localhost:5433/masarat'
const testUrl = process.env.TEST_DATABASE_URL ?? devUrl.replace(/\/[^/]+$/, '/masarat_test')
const testDb = new URL(testUrl).pathname.slice(1)

const admin = postgres(devUrl, { onnotice: () => {} })
const [exists] = await admin`select 1 from pg_database where datname = ${testDb}`
if (!exists) await admin.unsafe(`create database "${testDb}"`)
await admin.end()

process.env.DATABASE_URL = testUrl
process.env.DEMO_MODE = 'true'
process.env.STORAGE_DIR = `${import.meta.dir}/.storage`

const { migrate } = await import('drizzle-orm/postgres-js/migrator')
const { openUnlimitedDb } = await import('../src/db')
const { config } = await import('../src/config')
const migration = openUnlimitedDb()
await migrate(migration.db, { migrationsFolder: config.migrationsFolder })
await migration.close()
