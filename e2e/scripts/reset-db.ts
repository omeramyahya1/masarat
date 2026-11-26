// Before each end-to-end run: a fresh masarat_e2e database, migrated as the owner, with the API's
// role allowed to log in. The API then seeds the demo data at startup (demo mode), so every run
// starts from the same data.
import postgres from 'postgres'
import { E2E } from '../env'

const owner = new URL(E2E.migrationDatabaseUrl)
const database = owner.pathname.slice(1)
if (!database.includes('e2e'))
  throw new Error(`Refusing to reset "${database}": not an e2e database`)
const admin = postgres({ ...parse(owner), database: 'postgres', onnotice: () => {} })
await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
await admin.unsafe(`CREATE DATABASE "${database}"`)
await admin.end()

// The API's migrations, run the way `bun run db:migrate` does
const proc = Bun.spawn(['bun', 'src/db/migrate.ts'], {
  cwd: new URL('../../apps/api/', import.meta.url).pathname,
  env: { ...process.env, ...E2E.apiEnv },
  stdout: 'inherit',
  stderr: 'inherit'
})
if ((await proc.exited) !== 0) throw new Error('Migrating the e2e database failed')

function parse(url: URL): postgres.Options<Record<string, never>> {
  return {
    host: url.hostname,
    port: Number(url.port),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password)
  }
}
