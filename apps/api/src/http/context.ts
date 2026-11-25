// What the middleware puts on each request, and how results become responses
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { getConnInfo } from 'hono/bun'
import { config } from '../config'
import type { AuthUser } from '@masarat/shared/auth'
import type { ClientInfo } from '../services/sessions'

export interface AppEnv {
  Variables: {
    // The signed-in account with its role and permissions, or null (set by the session middleware)
    user: AuthUser | null
    // The session cookie's token, '' when there is none
    token: string
    // This request's id (X-Request-Id), on every log line it causes
    requestId: string
  }
}

export type AppContext = Context<AppEnv>

// Errors that aren't a problem with the request's fields; everything else is a 400
const STATUS: Record<string, ContentfulStatusCode> = {
  not_signed_in: 401,
  invalid_credentials: 401,
  forbidden: 403,
  account_disabled: 403,
  password_change_required: 403,
  user_not_found: 404,
  manifest_not_found: 404,
  vehicle_not_found: 404,
  driver_not_found: 404,
  charge_not_found: 404,
  template_not_found: 404,
  role_not_found: 404,
  branch_not_found: 404,
  too_large: 413,
  document_too_large: 413,
  not_found: 404,
  username_taken: 409,
  phone_taken: 409,
  last_admin: 409,
  role_in_use: 409,
  role_name_taken: 409,
  branch_name_taken: 409,
  role_locked: 403,
  cannot_change_self: 403,
  too_many_attempts: 429,
  query_timeout: 503,
  not_ready: 503,
  admin_exists: 409,
  invalid_request: 400,
  unknown: 500
}

type Result = { ok: true } | { ok: false; error: string }

// A service result as JSON: 200 when it succeeded, the error's status otherwise. The body is the
// same either way, so the client reads `error` from it.
export const send = <T extends Result>(c: AppContext, result: T): Response =>
  c.json(result, result.ok ? 200 : (STATUS[result.error] ?? 400))

export const fail = (c: AppContext, error: string): Response => send(c, { ok: false, error })

// The request's JSON body, or an empty object when it's missing or not JSON
export async function readJson(c: AppContext): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json()
    return body && typeof body === 'object' ? body : {}
  } catch {
    return {}
  }
}

export function clientInfo(c: AppContext): ClientInfo {
  let ip: string | null = null
  if (config.trustProxy) ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || null
  if (!ip) {
    try {
      ip = getConnInfo(c).remote.address ?? null
    } catch {
      // No socket (app.request() in tests)
    }
  }
  return { ip, userAgent: c.req.header('user-agent') ?? null }
}

// A positive integer :id, or null (answered as "not found")
export function idParam(c: AppContext): number | null {
  const id = Number(c.req.param('id'))
  return Number.isInteger(id) && id > 0 ? id : null
}
