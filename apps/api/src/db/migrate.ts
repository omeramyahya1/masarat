// Applies the pending migrations in apps/api/drizzle: `bun run db:migrate`, run before the API
// starts (locally and on every deploy). No statement timeout: building an index on a big table
// takes as long as it takes.
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { openUnlimitedDb } from './client'
import { config } from '../config'

const { db, close } = openUnlimitedDb()
await migrate(db, { migrationsFolder: config.migrationsFolder })
await close()
console.log('Migrations applied')
