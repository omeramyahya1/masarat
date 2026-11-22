// Applies the pending migrations in apps/api/drizzle: `bun run db:migrate`, run before the API
// starts (locally and on every deploy)
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { closeDb, getDb } from './client'
import { config } from '../config'

await migrate(getDb(), { migrationsFolder: config.migrationsFolder })
await closeDb()
console.log('Migrations applied')
