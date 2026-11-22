// Origin check, session lookup and access rules, in that order on every route that needs them
import type { MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { config } from '../config'
import type { Permission, UserKind } from '@masarat/shared/permissions'
import { accountOf } from '../services/access'
import { findSession, SESSION_COOKIE } from '../services/sessions'
import { fail, type AppEnv } from './context'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// CSRF protection: a request that changes something must come from one of the three Masarat web
// apps. Browsers always send Origin on such requests; the cookie being SameSite=Lax covers the
// rest.
export const originCheck = createMiddleware<AppEnv>(async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header('origin')
    if (!origin || !config.allowedOrigins.includes(origin)) return fail(c, 'forbidden')
  }
  return next()
})

export const session = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE) ?? ''
  c.set('token', token)
  const user = token ? await findSession(token) : null
  c.set('user', user ? await accountOf(user) : null)
  return next()
})

// Signed in, and past the forced password change unless the route is one that allows it
export const requireUser = (
  options: { duringPasswordChange?: boolean } = {}
): MiddlewareHandler<AppEnv> =>
  createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user')
    if (!user) return fail(c, 'not_signed_in')
    if (user.mustChangePassword && !options.duringPasswordChange) {
      return fail(c, 'password_change_required')
    }
    return next()
  })

// A company member or a government user
export const requireKind = (kind: UserKind): MiddlewareHandler<AppEnv> =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (c.get('user')?.kind !== kind) return fail(c, 'forbidden')
    return next()
  })

// The user's role grants at least one of these
export const requirePermission = (...permissions: Permission[]): MiddlewareHandler<AppEnv> =>
  createMiddleware<AppEnv>(async (c, next) => {
    const granted = c.get('user')?.permissions ?? []
    if (!permissions.some((p) => granted.includes(p))) return fail(c, 'forbidden')
    return next()
  })
