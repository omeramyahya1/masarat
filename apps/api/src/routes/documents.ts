// Trip attachments: uploading (staged until the trip is saved) and viewing
import { Hono } from 'hono'
import { findOwnedDocumentFile, stageDocument } from '../services/documents'
import { fail, idParam, send, type AppEnv } from '../http/context'
import { sendFile } from '../http/files'
import { companyScope, requireCompany, userId } from '../http/company'
import { requirePermission } from '../http/middleware'

export const documentRoutes = new Hono<AppEnv>()
  .use(...requireCompany)
  // multipart/form-data: docType, file
  .post('/', requirePermission('trips.edit'), async (c) => {
    let body: Record<string, unknown>
    try {
      body = await c.req.parseBody()
    } catch {
      return fail(c, 'invalid_document')
    }
    const file = body.file
    if (!(file instanceof File)) return fail(c, 'invalid_document')
    const bytes = new Uint8Array(await file.arrayBuffer())
    return send(c, stageDocument(userId(c), body.docType, file.name, bytes))
  })
  .get('/:id/file', requirePermission('trips.view'), async (c) => {
    const id = idParam(c)
    return sendFile(c, id === null ? undefined : await findOwnedDocumentFile(companyScope(c), id))
  })
