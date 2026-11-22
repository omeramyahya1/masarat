// Government portal → Users: government admins manage the government accounts
import { Hono } from 'hono'
import type { NewGovtUserInput } from '@masarat/shared/govtUsers'
import {
  createGovtUser,
  listGovtUsers,
  resetPassword,
  setAdmin,
  setDisabled
} from '../services/govtUsers'
import { fail, readJson, send, type AppContext, type AppEnv } from '../http/context'
import { requireAdmin, requireUser } from '../http/middleware'

const targetId = (c: AppContext): number | null => {
  const id = Number(c.req.param('id'))
  return Number.isInteger(id) && id > 0 ? id : null
}

export const govtUserRoutes = new Hono<AppEnv>()
  .use(requireUser(), requireAdmin)
  .get('/', async (c) => send(c, { ok: true, data: await listGovtUsers() }))
  .post('/', async (c) =>
    send(c, await createGovtUser((await readJson(c)) as unknown as NewGovtUserInput))
  )
  .post('/:id/disable', async (c) => {
    const id = targetId(c)
    return id === null
      ? fail(c, 'user_not_found')
      : send(c, await setDisabled(c.get('user')!.id, id, true))
  })
  .post('/:id/enable', async (c) => {
    const id = targetId(c)
    return id === null
      ? fail(c, 'user_not_found')
      : send(c, await setDisabled(c.get('user')!.id, id, false))
  })
  .post('/:id/reset-password', async (c) => {
    const id = targetId(c)
    return id === null
      ? fail(c, 'user_not_found')
      : send(c, await resetPassword(c.get('user')!.id, id))
  })
  .post('/:id/admin', async (c) => {
    const id = targetId(c)
    const { isAdmin } = await readJson(c)
    if (id === null) return fail(c, 'user_not_found')
    if (typeof isAdmin !== 'boolean') return fail(c, 'missing_fields')
    return send(c, await setAdmin(c.get('user')!.id, id, isAdmin))
  })
