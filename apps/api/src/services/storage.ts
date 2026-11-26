// Object storage for trip attachments: an S3-compatible bucket (MinIO), so every API instance sees
// the same files and none lives on an API server's disk. Bun's built-in S3 client; the rest of the
// API goes through this module only, so another S3 service (or a test double) can replace it.
import { S3Client } from 'bun'
import { config } from '../config'
import { addReadinessCheck } from './health'

export interface StoredObject {
  key: string
  lastModified: Date
}

let client: S3Client | null = null

function s3(): S3Client {
  client ??= new S3Client({
    endpoint: config.s3.endpoint,
    bucket: config.s3.bucket,
    region: config.s3.region,
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey
  })
  return client
}

export const objectStore = {
  async put(key: string, bytes: Uint8Array, type: string): Promise<void> {
    await s3().write(key, bytes, { type })
  },

  // The object's content as a stream, or null when there is no such object
  async stream(key: string): Promise<ReadableStream<Uint8Array> | null> {
    const file = s3().file(key)
    if (!(await file.exists())) return null
    return file.stream()
  },

  async exists(key: string): Promise<boolean> {
    return s3().exists(key)
  },

  // Deletes the objects; missing ones are fine. Throws if the storage can't be reached.
  async delete(keys: readonly string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 20) {
      await Promise.all(keys.slice(i, i + 20).map((key) => s3().unlink(key)))
    }
  },

  // Every object under a prefix (paged through 1,000 at a time)
  async list(prefix: string): Promise<StoredObject[]> {
    const found: StoredObject[] = []
    let startAfter: string | undefined
    for (;;) {
      const page = await s3().list({ prefix, maxKeys: 1000, startAfter })
      for (const item of page.contents ?? []) {
        found.push({ key: item.key, lastModified: new Date(item.lastModified ?? 0) })
      }
      if (!page.isTruncated || !page.contents?.length) return found
      startAfter = page.contents[page.contents.length - 1].key
    }
  }
}

// The bucket answers (a missing key is fine; an unreachable or refusing server is not)
addReadinessCheck('storage', async () => {
  await s3().exists('.ready')
})
