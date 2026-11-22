// Logging in and out, fleet owner sign-up, the signed-in user, the owner's profile and changing a
// password
import { Hono } from 'hono'
import type {
  ChangePasswordInput,
  LogInInput,
  ProfileInput,
  SignUpInput
} from '@masarat/shared/auth'
import { changePassword, logIn, signUp, toAuthUser, updateProfile } from '../services/auth'
import { deleteSession } from '../services/sessions'
import { clientInfo, readJson, send, type AppEnv } from '../http/context'
import { clearSessionCookie, setSessionCookie } from '../http/cookie'
import { requireRole, requireUser } from '../http/middleware'

export const authRoutes = new Hono<AppEnv>()
  .post('/login', async (c) => {
    const result = await logIn((await readJson(c)) as unknown as LogInInput, clientInfo(c))
    if (!result.ok) return send(c, result)
    // A session the browser already had (another account) is replaced
    await deleteSession(c.get('token'))
    setSessionCookie(c, result.token)
    return send(c, { ok: true, user: result.user })
  })
  .post('/signup', async (c) => {
    const result = await signUp((await readJson(c)) as unknown as SignUpInput, clientInfo(c))
    if (!result.ok) return send(c, result)
    await deleteSession(c.get('token'))
    setSessionCookie(c, result.token)
    return send(c, { ok: true, user: result.user })
  })
  .post('/logout', async (c) => {
    await deleteSession(c.get('token'))
    clearSessionCookie(c)
    return send(c, { ok: true })
  })
  .get('/me', requireUser({ duringPasswordChange: true }), (c) =>
    send(c, { ok: true, user: toAuthUser(c.get('user')!) })
  )
  .post('/change-password', requireUser({ duringPasswordChange: true }), async (c) => {
    const input = (await readJson(c)) as unknown as ChangePasswordInput
    return send(c, await changePassword(c.get('user')!.id, input, c.get('token')))
  })
  .patch('/profile', requireUser(), requireRole('owner'), async (c) => {
    const input = (await readJson(c)) as unknown as ProfileInput
    return send(c, await updateProfile(c.get('user')!.id, input))
  })
