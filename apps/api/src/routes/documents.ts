// Trip attachments: uploading (staged until the trip is saved) and viewing
import { Hono } from 'hono'
import { findOwnedDocumentFile, stageDocument } from '../services/documents'
import { idParam, send, type AppEnv } from '../http/context'
import { sendFile } from '../http/files'
import { companyScope, requireCompany, userId } from '../http/company'
import { requirePermission } from '../http/middleware'
import { doc, form } from '../http/validate'
import { z } from 'zod'

// multipart/form-data: the document type and the file (the service checks the type, size and its
// first bytes)
const uploadSchema = z.object({ docType: z.string().max(60), file: z.instanceof(File) })

export const documentRoutes = new Hono<AppEnv>()
  .use(...requireCompany)
  .post(
    '/',
    doc('Documents', 'Upload an attachment (staged until the trip is saved)'),
    requirePermission('trips.edit'),
    form(uploadSchema, 'invalid_document'),
    async (c) => {
      const { docType, file } = c.req.valid('form')
      const bytes = new Uint8Array(await file.arrayBuffer())
      return send(c, await stageDocument(userId(c), docType, file.name, bytes))
    }
  )
  .get(
    '/:id/file',
    doc('Documents', 'An attachment’s file'),
    requirePermission('trips.view'),
    async (c) => {
      const id = idParam(c)
      return await sendFile(
        c,
        id === null ? undefined : await findOwnedDocumentFile(companyScope(c), id)
      )
    }
  )
