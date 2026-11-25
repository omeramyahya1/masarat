// Files attached to trips, kept in object storage (services/storage.ts), never on an API server's
// disk, so any API instance can serve any file.
//
// An upload is checked (type, size, first bytes), written to `documents/<upload day>/<token>.<ext>`
// and staged in Redis under its random token for 24 hours, for the member who uploaded it only.
// Saving the trip records the object's key in trip_documents; the object doesn't move. A file that
// was uploaded but never saved is deleted by the daily sweep (sweepUnusedUploads), which looks at
// the uploads of two days ago, once their staging has expired.
import { randomBytes } from 'crypto'
import { basename, extname } from 'path'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb, tripViews, vehicles, type TripDocument } from '../db'
import { log } from '../log'
import { tripScopeCondition, type TripScope } from './access'
import { getRedis } from './redis'
import { objectStore } from './storage'
import {
  DOCUMENT_EXTENSIONS,
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  type DocumentType,
  type FleetResult,
  type StagedDocument
} from '@masarat/shared/fleet'

// Reads live and archived trips alike (the all_* views)
const { manifests, tripDocuments } = tripViews

const TOKEN_PATTERN = /^[0-9a-f]{32}$/
// How long an upload waits for its trip to be saved
export const STAGING_TTL_S = 24 * 60 * 60

export const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg'
}

export const isDocumentType = (value: unknown): value is DocumentType =>
  (DOCUMENT_TYPES as readonly unknown[]).includes(value)

// A staged upload: who may attach it, and where its file is
export interface Staged extends StagedDocument {
  userId: number
  // The object's key in the bucket (trip_documents.stored_name once saved)
  storedName: string
}

const stagingKey = (token: string): string => `staging:${token}`

// The local (Sudan) day, YYYY-MM-DD, that names an upload's folder
const dayOf = (date: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
export const uploadPrefix = (date: Date): string => `documents/${dayOf(date)}/`

// The first bytes each allowed type starts with, so a renamed file of another kind is refused
const SIGNATURES: Record<string, number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]],
  png: [[0x89, 0x50, 0x4e, 0x47]],
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]]
}
const hasSignature = (bytes: Uint8Array, extension: string): boolean =>
  (SIGNATURES[extension] ?? []).some((signature) => signature.every((b, i) => bytes[i] === b))

// Stores an uploaded file and stages it, for the trip form to attach when the trip is saved
export async function stageDocument(
  userId: number,
  docType: unknown,
  fileName: string,
  bytes: Uint8Array
): Promise<FleetResult<StagedDocument>> {
  if (!isDocumentType(docType)) return { ok: false, error: 'invalid_document' }
  const extension = extname(fileName).slice(1).toLowerCase()
  if (!(DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    return { ok: false, error: 'invalid_document' }
  }
  const size = bytes.byteLength
  if (size > MAX_DOCUMENT_BYTES) return { ok: false, error: 'document_too_large' }
  if (!hasSignature(bytes, extension)) return { ok: false, error: 'invalid_document' }

  const token = randomBytes(16).toString('hex')
  const storedName = `${uploadPrefix(new Date())}${token}.${extension}`
  await objectStore.put(storedName, bytes, CONTENT_TYPES[extension])
  const document: StagedDocument = { token, docType, fileName: basename(fileName), size }
  const staged: Staged = { ...document, userId, storedName }
  await getRedis().set(stagingKey(token), JSON.stringify(staged), 'EX', STAGING_TTL_S)
  return { ok: true, data: document }
}

// A staged upload, if the token is one we handed this member and it hasn't expired
export async function findStaged(userId: number, token: unknown): Promise<Staged | undefined> {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return undefined
  const value = await getRedis().get(stagingKey(token))
  if (!value) return undefined
  const staged = JSON.parse(value) as Staged
  return staged.userId === userId ? staged : undefined
}

// Once the trip that attached them is saved, the tokens can't be used again
export async function consumeStaged(documents: readonly Staged[]): Promise<void> {
  if (documents.length === 0) return
  await getRedis().del(...documents.map((d) => stagingKey(d.token)))
}

// Deletes attachments' files after their rows are gone. The rows are what counts: a file that
// can't be deleted now is only logged (it's no longer reachable from the app).
export async function removeStoredObjects(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  try {
    await objectStore.delete(keys)
  } catch (err) {
    log.error('Removing attachment files failed', err, { keys })
  }
}

// The daily sweep: uploads of the day before yesterday that no trip uses (their staging expired
// unused) are deleted. Returns how many.
export async function sweepUnusedUploads(now = new Date()): Promise<number> {
  const day = new Date(now)
  day.setDate(day.getDate() - 2)
  const uploads = await objectStore.list(uploadPrefix(day))
  let removed = 0
  for (let i = 0; i < uploads.length; i += 1000) {
    const keys = uploads.slice(i, i + 1000).map((u) => u.key)
    const used = await getDb()
      .select({ key: tripDocuments.storedName })
      .from(tripDocuments)
      .where(inArray(tripDocuments.storedName, keys))
    const inUse = new Set(used.map((u) => u.key))
    const unused = keys.filter((key) => !inUse.has(key))
    await objectStore.delete(unused)
    removed += unused.length
  }
  return removed
}

// An attachment of a trip the scope may see, by id. A null scope is the government, which may open
// any trip's attachments.
async function findOwnedDocument(
  scope: TripScope,
  documentId: unknown
): Promise<Pick<TripDocument, 'storedName' | 'fileName'> | undefined> {
  if (typeof documentId !== 'number') return undefined
  const [row] = await getDb()
    .select({
      document: { storedName: tripDocuments.storedName, fileName: tripDocuments.fileName }
    })
    .from(tripDocuments)
    .innerJoin(manifests, eq(tripDocuments.manifestId, manifests.id))
    .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
    .where(and(eq(tripDocuments.id, documentId), tripScopeCondition(scope, manifests)))
    .limit(1)
  return row?.document
}

// A saved attachment's object and original name, for the viewer
export async function findOwnedDocumentFile(
  scope: TripScope,
  documentId: unknown
): Promise<{ key: string; fileName: string } | undefined> {
  const document = await findOwnedDocument(scope, documentId)
  return document ? { key: document.storedName, fileName: document.fileName } : undefined
}
