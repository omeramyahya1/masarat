// Logging in and out, company sign-up, the signed-in user, one's own profile and changing a
// password
import { Hono } from 'hono'
import {
  changePasswordSchema,
  logInSchema,
  profileSchema,
  signUpSchema
} from '@masarat/shared/schemas'
import { changePassword, logIn, signUp, updateProfile } from '../services/auth'
import { deleteSession } from '../services/sessions'
import { clientInfo, send, type AppEnv } from '../http/context'
import { clearSessionCookie, setSessionCookie } from '../http/cookie'
import { requireUser } from '../http/middleware'
import { body, doc } from '../http/validate'

const TAG = 'Auth'

export const authRoutes = new Hono<AppEnv>()
  .post('/login', doc(TAG, 'Log in'), body(logInSchema), async (c) => {
    const result = await logIn(c.req.valid('json'), clientInfo(c))
    if (!result.ok) return send(c, result)
    // A session the browser already had (another account) is replaced
    await deleteSession(c.get('token'))
    setSessionCookie(c, result.token)
    return send(c, { ok: true, user: result.user })
  })
  .post(
    '/signup',
    doc(TAG, 'Sign up a transport company'),
    body(signUpSchema, 'missing_fields'),
    async (c) => {
      const result = await signUp(c.req.valid('json'), clientInfo(c))
      if (!result.ok) return send(c, result)
      await deleteSession(c.get('token'))
      setSessionCookie(c, result.token)
      return send(c, { ok: true, user: result.user })
    }
  )
  .post('/logout', doc(TAG, 'Log out'), async (c) => {
    await deleteSession(c.get('token'))
    clearSessionCookie(c)
    return send(c, { ok: true })
  })
  .get('/me', doc(TAG, 'The signed-in account'), requireUser({ duringPasswordChange: true }), (c) =>
    send(c, { ok: true, user: c.get('user')! })
  )
  .post(
    '/change-password',
    doc(TAG, 'Change one’s own password'),
    requireUser({ duringPasswordChange: true }),
    body(changePasswordSchema),
    async (c) =>
      send(c, await changePassword(c.get('user')!.id, c.req.valid('json'), c.get('token')))
  )
  .patch(
    '/profile',
    doc(TAG, 'Update one’s own name and phone'),
    requireUser(),
    body(profileSchema),
    async (c) => send(c, await updateProfile(c.get('user')!.id, c.req.valid('json')))
  )
