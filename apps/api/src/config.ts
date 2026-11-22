// The API's settings, from the environment (Bun loads apps/api/.env). The defaults suit local
// development (run from apps/api); see .env.example.
import { resolve } from 'path'

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://masarat:masarat@localhost:5433/masarat',
  migrationsFolder: resolve(import.meta.dir, '..', 'drizzle'),
  // Trip attachments: documents/<manifest id>/ and documents/staging/
  storageDir: resolve(process.env.STORAGE_DIR ?? 'storage'),
  // Seeds the demo fleet companies and enables the demo-only actions; off in production
  demoMode: process.env.DEMO_MODE === 'true'
}
