// Government portal → Users: government admins manage the government accounts (the same rules as a
// company's Team, see services/members.ts)
import { Hono } from 'hono'
import type { AppEnv } from '../http/context'
import { requireKind, requirePermission, requireUser } from '../http/middleware'
import { memberRoutes } from './company'

export const govtUserRoutes = new Hono<AppEnv>()
  .use(requireUser(), requireKind('govt'), requirePermission('govt.users'))
  .route(
    '/',
    memberRoutes(() => ({ kind: 'govt' }))
  )
