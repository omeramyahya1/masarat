// A company's passenger trip templates: listed for booking (templates.use), kept with
// templates.manage
import { Hono } from 'hono'
import type { TemplateInput } from '@masarat/shared/templates'
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate
} from '../services/templates'
import { fail, idParam, readJson, send, type AppEnv } from '../http/context'
import { companyScope, requireCompany } from '../http/company'
import { requirePermission } from '../http/middleware'

export const templateRoutes = new Hono<AppEnv>()
  .use(...requireCompany)
  .get('/', requirePermission('templates.use'), async (c) =>
    send(c, { ok: true, data: await listTemplates(companyScope(c)) })
  )
  .post('/', requirePermission('templates.manage'), async (c) =>
    send(c, await createTemplate(companyScope(c), (await readJson(c)) as unknown as TemplateInput))
  )
  .put('/:id', requirePermission('templates.manage'), async (c) => {
    const id = idParam(c)
    if (id === null) return fail(c, 'template_not_found')
    const input = (await readJson(c)) as unknown as TemplateInput
    return send(c, await updateTemplate(companyScope(c), id, input))
  })
  .delete('/:id', requirePermission('templates.manage'), async (c) => {
    const id = idParam(c)
    return id === null
      ? fail(c, 'template_not_found')
      : send(c, await deleteTemplate(companyScope(c), id))
  })
