// The session cookie: HttpOnly, SameSite=Lax, on the parent domain in production so masarat.com,
// owner. and govt. all send it to api.masarat.com. No Max-Age: the server decides when it ends.
import { deleteCookie, setCookie } from 'hono/cookie'
import { config } from '../config'
import { SESSION_COOKIE } from '../services/sessions'
import type { AppContext } from './context'

const options = {
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: 'Lax',
  path: '/',
  domain: config.cookieDomain
} as const

export const setSessionCookie = (c: AppContext, token: string): void =>
  setCookie(c, SESSION_COOKIE, token, options)

export const clearSessionCookie = (c: AppContext): void => {
  deleteCookie(c, SESSION_COOKIE, options)
}
