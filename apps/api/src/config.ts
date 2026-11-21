// Where the API keeps its data on disk. Set from the environment so each deployment chooses its
// own folders; the defaults suit local development (run from apps/api).
import { resolve } from 'path'

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databasePath: resolve(process.env.DATABASE_PATH ?? 'masarat.db'),
  migrationsFolder: resolve(import.meta.dir, '..', 'drizzle'),
  // Trip attachments: documents/<manifest id>/ and documents/staging/
  storageDir: resolve(process.env.STORAGE_DIR ?? 'storage')
}
