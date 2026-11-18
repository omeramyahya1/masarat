// Files attached to trips. A picked file is first copied into a staging folder and named by a
// random token; saving the trip moves it to documents/<manifest id>/ and records it in
// trip_documents. Staging is emptied on startup, so files picked for a trip that was never saved
// don't pile up.
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { randomBytes } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import { and, eq } from 'drizzle-orm'
import { getDb, manifests, tripDocuments, vehicles, type TripDocument } from '../db'
import {
  DOCUMENT_EXTENSIONS,
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  type DocumentType,
  type FleetResult,
  type StagedDocument
} from '../../shared/fleet'

const TOKEN_PATTERN = /^[0-9a-f]{32}$/

const documentsRoot = (): string => join(app.getPath('userData'), 'documents')
const stagingDir = (): string => join(documentsRoot(), 'staging')
const manifestDir = (manifestId: number): string => join(documentsRoot(), String(manifestId))

export const isDocumentType = (value: unknown): value is DocumentType =>
  (DOCUMENT_TYPES as readonly unknown[]).includes(value)

// What we know about a staged file; kept in memory, since staging doesn't outlive the app
interface Staged extends StagedDocument {
  storedName: string
}
const staged = new Map<string, Staged>()

export function clearStaging(): void {
  rmSync(stagingDir(), { recursive: true, force: true })
  staged.clear()
}

// Asks the owner for a file and copies it into staging. Null data means they cancelled.
export async function pickDocument(
  window: BrowserWindow | null,
  docType: unknown
): Promise<FleetResult<StagedDocument | null>> {
  if (!isDocumentType(docType)) return { ok: false, error: 'invalid_document' }
  const options = {
    properties: ['openFile' as const],
    filters: [{ name: 'PDF / JPG / PNG', extensions: [...DOCUMENT_EXTENSIONS] }]
  }
  const { canceled, filePaths } = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  const source = filePaths[0]
  if (canceled || !source) return { ok: true, data: null }

  const extension = extname(source).slice(1).toLowerCase()
  if (!(DOCUMENT_EXTENSIONS as readonly string[]).includes(extension)) {
    return { ok: false, error: 'invalid_document' }
  }
  const { size } = statSync(source)
  if (size > MAX_DOCUMENT_BYTES) return { ok: false, error: 'document_too_large' }

  const token = randomBytes(16).toString('hex')
  const storedName = `${token}.${extension}`
  mkdirSync(stagingDir(), { recursive: true })
  copyFileSync(source, join(stagingDir(), storedName))
  const document: StagedDocument = { token, docType, fileName: basename(source), size }
  staged.set(token, { ...document, storedName })
  return { ok: true, data: document }
}

// A staged file, if the token is one we handed out and the file is still there
export function findStaged(token: unknown): Staged | undefined {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return undefined
  const document = staged.get(token)
  return document && existsSync(join(stagingDir(), document.storedName)) ? document : undefined
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
function findOwnedDocument(ownerId: number, documentId: unknown): TripDocument | undefined {
  if (typeof documentId !== 'number') return undefined
  return getDb()
    .select({ document: tripDocuments })
    .from(tripDocuments)
    .innerJoin(manifests, eq(tripDocuments.manifestId, manifests.id))
    .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
    .where(and(eq(tripDocuments.id, documentId), eq(vehicles.ownerId, ownerId)))
    .get()?.document
}

// The file of a saved attachment, for the scanner
export function ownedDocumentPath(ownerId: number, documentId: unknown): string | undefined {
  const document = findOwnedDocument(ownerId, documentId)
  return document ? storedPath(document.manifestId, document.storedName) : undefined
}

// Opens an attachment in the system's default viewer
export async function openDocument(
  ownerId: number,
  documentId: unknown
): Promise<FleetResult<null>> {
  const path = ownedDocumentPath(ownerId, documentId)
  if (!path || !existsSync(path)) return { ok: false, error: 'invalid_document' }
  const error = await shell.openPath(path)
  return error ? { ok: false, error: 'unknown' } : { ok: true, data: null }
}
