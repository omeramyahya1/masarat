import postgres from 'postgres'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from './schema'
import { config } from '../config'

export type AppDatabase = PostgresJsDatabase<typeof schema>

// One connection pool per process, opened on first use. Migrations are a separate deploy step
// (`bun run db:migrate`), so the API never changes the schema while serving requests.
let client: postgres.Sql | null = null
let database: AppDatabase | null = null

export function getDb(): AppDatabase {
  if (!database) {
    // Notices ("already exists, skipping" from migrations, …) are informational only
    client = postgres(config.databaseUrl, {
      max: config.dbPoolMax,
      onnotice: () => {},
      connection: { TimeZone: config.timeZone }
    })
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

export { schema }
