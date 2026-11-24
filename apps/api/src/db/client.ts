import postgres from 'postgres'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from './schema'
import { config } from '../config'

export type AppDatabase = PostgresJsDatabase<typeof schema>

// A connection pool with the given statement timeout (ms; 0 = none). Postgres stops a query that
// runs longer, instead of letting it run on after the request that asked for it has given up.
function openPool(statementTimeoutMs: number, max: number): postgres.Sql {
  return postgres(config.databaseUrl, {
    max,
    // Notices ("already exists, skipping" from migrations, …) are informational only
    onnotice: () => {},
    connection: { TimeZone: config.timeZone, statement_timeout: statementTimeoutMs }
  })
}

// One connection pool per process, opened on first use, with the API's statement timeout.
// Migrations are a separate deploy step (`bun run db:migrate`), so the API never changes the
// schema while serving requests.
let client: postgres.Sql | null = null
let database: AppDatabase | null = null

export function getDb(): AppDatabase {
  if (!database) {
    client = openPool(config.statementTimeoutMs, config.dbPoolMax)
    database = drizzle(client, { schema })
  }
  return database
}

export async function closeDb(): Promise<void> {
  const open = client
  client = null
  database = null
  await open?.end()
}

// A single connection without a statement timeout, for work that is long by nature: migrations
// (an index on a big table) and bulk seeding. Close it when done.
export function openUnlimitedDb(): { db: AppDatabase; close: () => Promise<void> } {
  const pool = openPool(0, 1)
  return { db: drizzle(pool, { schema }), close: () => pool.end() }
}

export { schema }
