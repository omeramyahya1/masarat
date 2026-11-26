// Applies the pending migrations in apps/api/drizzle: `bun run db:migrate`, run before the API
// starts (locally and on every deploy), as the owner (MIGRATION_DATABASE_URL). No statement
// timeout: building an index on a big table takes as long as it takes. In development it also lets
// the API's role (DATABASE_URL) log in with its development password.
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { openUnlimitedDb } from './client'
import { enableDevAppRole } from './devAppRole'
import { config } from '../config'

const { db, close } = openUnlimitedDb()
await migrate(db, { migrationsFolder: config.migrationsFolder })
if (!config.production) await enableDevAppRole(db)
await close()
console.log('Migrations applied')
