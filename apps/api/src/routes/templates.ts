// A company's passenger trip templates: listed for booking (templates.use), kept with
// templates.manage
import { Hono } from 'hono'
import { templateSchema } from '@masarat/shared/schemas'
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate
} from '../services/templates'
import { fail, idParam, send, type AppEnv } from '../http/context'
import { companyScope, requireCompany } from '../http/company'
import { requirePermission } from '../http/middleware'
import { body, doc } from '../http/validate'

export const templateRoutes = new Hono<AppEnv>()
  .use(...requireCompany)
  .get(
    '/',
    doc('Templates', 'Passenger trip templates'),
    requirePermission('templates.use'),
    async (c) => send(c, { ok: true, data: await listTemplates(companyScope(c)) })
  )
  .post(
    '/',
    doc('Templates', 'Add a template'),
    requirePermission('templates.manage'),
    body(templateSchema),
    async (c) => send(c, await createTemplate(companyScope(c), c.req.valid('json')))
  )
  .put(
    '/:id',
    doc('Templates', 'Edit a template'),
    requirePermission('templates.manage'),
    body(templateSchema),
    async (c) => {
      const id = idParam(c)
      if (id === null) return fail(c, 'template_not_found')
      return send(c, await updateTemplate(companyScope(c), id, c.req.valid('json')))
    }
  )
  .delete(
    '/:id',
    doc('Templates', 'Delete a template'),
    requirePermission('templates.manage'),
    async (c) => {
      const id = idParam(c)
      return id === null
        ? fail(c, 'template_not_found')
        : send(c, await deleteTemplate(companyScope(c), id))
    }
  )
