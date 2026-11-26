// One-off, after upgrading to object storage: copies the attachments the API used to keep on its
// disk (<STORAGE_DIR>/documents/<manifest id>/<file>) into the bucket, as
// documents/legacy/<manifest id>/<file>, and points their rows there. Safe to run again: rows
// already pointing into the bucket are skipped. The disk folder can be removed afterwards.
//   bun run --filter @masarat/api storage:migrate
import { existsSync, readFileSync } from 'fs'
import { extname, join } from 'path'
import { eq, not, like } from 'drizzle-orm'
import { config } from '../config'
import { closeDb, getDb, tripDocuments } from '../db'
import { CONTENT_TYPES } from '../services/documents'
import { objectStore } from '../services/storage'
import { closeRedis } from '../services/redis'

const rows = await getDb()
  .select({
    id: tripDocuments.id,
    manifestId: tripDocuments.manifestId,
    storedName: tripDocuments.storedName
  })
  .from(tripDocuments)
  .where(not(like(tripDocuments.storedName, 'documents/%')))

let moved = 0
let missing = 0
for (const row of rows) {
  const path = join(config.storageDir, 'documents', String(row.manifestId), row.storedName)
  if (!existsSync(path)) {
    missing++
    console.warn(`Missing on disk: ${path} (document ${row.id})`)
    continue
  }
  const key = `documents/legacy/${row.manifestId}/${row.storedName}`
  const extension = extname(row.storedName).slice(1).toLowerCase()
  await objectStore.put(
    key,
    readFileSync(path),
    CONTENT_TYPES[extension] ?? 'application/octet-stream'
  )
  await getDb().update(tripDocuments).set({ storedName: key }).where(eq(tripDocuments.id, row.id))
  moved++
}
await closeDb()
closeRedis()
console.log(`Moved ${moved} attachment(s) to the bucket; ${missing} missing on disk`)
