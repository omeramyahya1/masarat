// Files attached to trips. An uploaded file is first written to a staging folder and named by a
// random token; saving the trip moves it to documents/<manifest id>/ and records it in
// trip_documents. Staging is emptied on startup, so files picked for a trip that was never saved
// don't pile up.
import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { and, eq } from 'drizzle-orm'
import { config } from '../config'
import { getDb, manifests, tripDocuments, vehicles, type TripDocument } from '../db'
import {
  DOCUMENT_EXTENSIONS,
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  type DocumentType,
  type FleetResult,
  type StagedDocument
} from '@masarat/shared/fleet'

const TOKEN_PATTERN = /^[0-9a-f]{32}$/

const documentsRoot = (): string => join(config.storageDir, 'documents')
const stagingDir = (): string => join(documentsRoot(), 'staging')
const manifestDir = (manifestId: number): string => join(documentsRoot(), String(manifestId))

export const isDocumentType = (value: unknown): value is DocumentType =>
  (DOCUMENT_TYPES as readonly unknown[]).includes(value)

// What we know about a staged file; kept in memory, since staging doesn't outlive the API process.
// It belongs to the owner who uploaded it: nobody else can attach it.
interface Staged extends StagedDocument {
  ownerId: number
  storedName: string
}
const staged = new Map<string, Staged>()

export function clearStaging(): void {
  rmSync(stagingDir(), { recursive: true, force: true })
  staged.clear()
}

// Removes trip folders no attachment row points to any more: left behind when removing them
// failed after their trip (or its attachments) was deleted. Runs on startup.
export async function removeOrphanFolders(): Promise<void> {
  if (!existsSync(documentsRoot())) return
  const rows = await getDb()
    .selectDistinct({ manifestId: tripDocuments.manifestId })
    .from(tripDocuments)
  const inUse = new Set(rows.map((d) => String(d.manifestId)))
  for (const entry of readdirSync(documentsRoot(), { withFileTypes: true })) {
    if (entry.isDirectory() && /^\d+$/.test(entry.name) && !inUse.has(entry.name)) {
      rmSync(join(documentsRoot(), entry.name), { recursive: true, force: true })
    }
  }
}

// The first bytes each allowed type starts with, so a renamed file of another kind is refused
const SIGNATURES: Record<string, number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]],
  png: [[0x89, 0x50, 0x4e, 0x47]],
  jpg: [[0xff, 0xd8, 0xff]],
  jpeg: [[0xff, 0xd8, 0xff]]
}
const hasSignature = (bytes: Uint8Array, extension: string): boolean =>
  (SIGNATURES[extension] ?? []).some((signature) => signature.every((b, i) => bytes[i] === b))

// Writes an uploaded file into staging, for the trip form to attach when the trip is saved
export function stageDocument(
  ownerId: number,
  docType: unknown,
  fileName: string,
  bytes: Uint8Array
): FleetResult<StagedDocument> {
  if (!isDocumentType(docType)) return { ok: false, error: 'invalid_document' }
  const extension = extname(fileName).slice(1).toLowerCase()
  if (!(DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    return { ok: false, error: 'invalid_document' }
  }
  const size = bytes.byteLength
  if (size > MAX_DOCUMENT_BYTES) return { ok: false, error: 'document_too_large' }
  if (!hasSignature(bytes, extension)) return { ok: false, error: 'invalid_document' }

  const token = randomBytes(16).toString('hex')
  const storedName = `${token}.${extension}`
  mkdirSync(stagingDir(), { recursive: true })
  writeFileSync(join(stagingDir(), storedName), bytes)
  const document: StagedDocument = { token, docType, fileName: basename(fileName), size }
  staged.set(token, { ...document, ownerId, storedName })
  return { ok: true, data: document }
}

// A staged file, if the token is one we handed this owner and the file is still there
export function findStaged(ownerId: number, token: unknown): Staged | undefined {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return undefined
  const document = staged.get(token)
  if (!document || document.ownerId !== ownerId) return undefined
  return existsSync(join(stagingDir(), document.storedName)) ? document : undefined
}

export const stagedPath = (document: Staged): string => join(stagingDir(), document.storedName)
export const storedPath = (manifestId: number, storedName: string): string =>
  join(manifestDir(manifestId), storedName)

// Moves staged files into the trip's folder (after its rows are written)
export function moveStaged(manifestId: number, documents: readonly Staged[]): void {
  if (documents.length === 0) return
  mkdirSync(manifestDir(manifestId), { recursive: true })
  for (const document of documents) {
    renameSync(stagedPath(document), storedPath(manifestId, document.storedName))
    staged.delete(document.token)
  }
}

export function removeStoredFiles(manifestId: number, storedNames: readonly string[]): void {
  for (const name of storedNames) rmSync(storedPath(manifestId, name), { force: true })
}

export function removeTripFolder(manifestId: number): void {
  rmSync(manifestDir(manifestId), { recursive: true, force: true })
}

// The owner's own attachment, by id
// A null owner is the government, which may open any trip's attachments
async function findOwnedDocument(
  ownerId: number | null,
  documentId: unknown
): Promise<TripDocument | undefined> {
  if (typeof documentId !== 'number') return undefined
  const [row] = await getDb()
    .select({ document: tripDocuments })
    .from(tripDocuments)
    .innerJoin(manifests, eq(tripDocuments.manifestId, manifests.id))
    .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
    .where(
      and(
        eq(tripDocuments.id, documentId),
        ownerId === null ? undefined : eq(vehicles.ownerId, ownerId)
      )
    )
    .limit(1)
  return row?.document
}

// A saved attachment's file and original name, for the viewer
export async function findOwnedDocumentFile(
  ownerId: number | null,
  documentId: unknown
): Promise<{ path: string; fileName: string } | undefined> {
  const document = await findOwnedDocument(ownerId, documentId)
  return document
    ? { path: storedPath(document.manifestId, document.storedName), fileName: document.fileName }
    : undefined
}
