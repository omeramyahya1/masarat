// Trip attachments: uploading (staged until the trip is saved), viewing, and the simulated OCR
import { Hono } from 'hono'
import type { ScanInput } from '@masarat/shared/ocr'
import { findOwnedDocumentFile, stageDocument } from '../services/documents'
import { scanDocument } from '../services/ocr'
import { fail, idParam, readJson, send, type AppEnv } from '../http/context'
import { sendFile } from '../http/files'
import { ownerId, requireOwner } from '../http/owner'

export const documentRoutes = new Hono<AppEnv>()
  .use(...requireOwner)
  // multipart/form-data: docType, file
  .post('/', async (c) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.parseBody()
    } catch {
      return fail(c, 'invalid_document')
    }
    const file = body.file
    if (!(file instanceof File)) return fail(c, 'invalid_document')
    const bytes = new Uint8Array(await file.arrayBuffer())
    return send(c, stageDocument(ownerId(c), body.docType, file.name, bytes))
  })
  .post('/scan', async (c) =>
    send(c, await scanDocument(ownerId(c), (await readJson(c)) as unknown as ScanInput))
  )
  .get('/:id/file', async (c) => {
    const id = idParam(c)
    return sendFile(c, id === null ? undefined : await findOwnedDocumentFile(ownerId(c), id))
  })
