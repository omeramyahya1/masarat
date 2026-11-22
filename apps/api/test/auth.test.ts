// Logging in across the three web apps: sessions, their limits, the rate limit, the Origin check,
// forced password changes and the government Users section
import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { getDb, sessions, users } from '../src/db'
import { hashPassword, logIn } from '../src/services/auth'
import { setAdmin, setDisabled } from '../src/services/govtUsers'
import { ABSOLUTE_MS, IDLE_MS, createSession, findSession } from '../src/services/sessions'
import { browser, createUser, resetData } from './helpers'

const PASSWORD = 'correct-horse'

async function createAccount(
  username: string,
  role: 'owner' | 'govt',
  values: Partial<typeof users.$inferInsert> = {}
): Promise<number> {
  return createUser({ username, role, passwordHash: await hashPassword(PASSWORD), ...values })
}

beforeEach(resetData)

describe('login', () => {
  test('sets the session cookie and /auth/me returns the account', async () => {
    await createAccount('owner.one', 'owner')
    const b = browser()
    const login = await b.call('POST', '/auth/login', { username: 'Owner.One', password: PASSWORD })
    expect(login.status).toBe(200)
    expect(login.body.user).toMatchObject({ username: 'owner.one', role: 'owner', isAdmin: false })
    expect(b.cookie).toStartWith('masarat_session=')

    const me = await b.call('GET', '/auth/me')
    expect(me.body.user.username).toBe('owner.one')

    expect((await b.call('POST', '/auth/logout')).status).toBe(200)
    expect(b.cookie).toBe('')
    expect((await browser().call('GET', '/auth/me')).status).toBe(401)
  })

  test('the cookie is HttpOnly and SameSite=Lax', async () => {
    await createAccount('owner.one', 'owner')
    const { app } = await import('../src/app')
    const response = await app.request('/auth/login', {
      method: 'POST',
      headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'owner.one', password: PASSWORD })
    })
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
  })

  test('a wrong password and an unknown username answer the same', async () => {
    await createAccount('owner.one', 'owner')
    const wrong = await browser().call('POST', '/auth/login', {
      username: 'owner.one',
      password: 'x'
    })
    const unknown = await browser().call('POST', '/auth/login', {
      username: 'nobody',
      password: 'x'
    })
    expect(wrong).toMatchObject({ status: 401, body: { ok: false, error: 'invalid_credentials' } })
    expect(unknown.body).toEqual(wrong.body)
  })

  test('a disabled account is refused, after the password checks out', async () => {
    await createAccount('govt.off', 'govt', { disabledAt: new Date() })
    const b = browser()
    expect(
      (await b.call('POST', '/auth/login', { username: 'govt.off', password: 'x' })).body.error
    ).toBe('invalid_credentials')
    const right = await b.call('POST', '/auth/login', { username: 'govt.off', password: PASSWORD })
    expect(right.body.error).toBe('account_disabled')
    expect(b.cookie).toBe('')
  })

  test('five failures lock the username for the window', async () => {
    await createAccount('owner.one', 'owner')
    const client = { ip: '10.0.0.1', userAgent: null }
    const now = new Date()
    for (let i = 0; i < 5; i++) {
      expect((await logIn({ username: 'owner.one', password: 'nope' }, client, now)).ok).toBe(false)
    }
    const locked = await logIn({ username: 'owner.one', password: PASSWORD }, client, now)
    expect(locked).toEqual({ ok: false, error: 'too_many_attempts' })
    const later = new Date(now.getTime() + 16 * 60 * 1000)
    expect((await logIn({ username: 'owner.one', password: PASSWORD }, client, later)).ok).toBe(
      true
    )
  })

  test('twenty failures from one IP lock that IP', async () => {
    const client = { ip: '10.0.0.2', userAgent: null }
    for (let i = 0; i < 20; i++) await logIn({ username: `user${i}`, password: 'nope' }, client)
    await createAccount('owner.two', 'owner')
    expect(await logIn({ username: 'owner.two', password: PASSWORD }, client)).toEqual({
      ok: false,
      error: 'too_many_attempts'
    })
    expect(
      (
        await logIn(
          { username: 'owner.two', password: PASSWORD },
          { ip: '10.0.0.3', userAgent: null }
        )
      ).ok
    ).toBe(true)
  })
})

describe('sessions', () => {
  test('end after 2 hours idle and 12 hours in all', async () => {
    const userId = await createAccount('owner.one', 'owner')
    const start = new Date('2026-11-22T08:00:00Z')
    const at = (ms: number): Date => new Date(start.getTime() + ms)

    const idle = await createSession(userId, { ip: null, userAgent: null }, start)
    expect(await findSession(idle, at(IDLE_MS - 1000))).not.toBeNull()
    // Used just now, so the idle clock restarted
    expect(await findSession(idle, at(2 * IDLE_MS - 2000))).not.toBeNull()
    expect(await findSession(idle, at(4 * IDLE_MS))).toBeNull()

    const busy = await createSession(userId, { ip: null, userAgent: null }, start)
    for (let t = 0; t < ABSOLUTE_MS; t += IDLE_MS / 2) {
      expect(await findSession(busy, at(t))).not.toBeNull()
    }
    expect(await findSession(busy, at(ABSOLUTE_MS))).toBeNull()
  })

  test('only a hash of the token is stored', async () => {
    const userId = await createAccount('owner.one', 'owner')
    const token = await createSession(userId, { ip: null, userAgent: null })
    const rows = await getDb().select().from(sessions)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).not.toBe(token)
    expect(rows[0].id).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('origin check', () => {
  test('refuses changes from other sites, and requests without an Origin', async () => {
    await createAccount('owner.one', 'owner')
    const evil = await browser('https://evil.example').call('POST', '/auth/login', {
      username: 'owner.one',
      password: PASSWORD
    })
    expect(evil).toMatchObject({ status: 403, body: { ok: false, error: 'forbidden' } })

    const { app } = await import('../src/app')
    const bare = await app.request('/auth/logout', { method: 'POST' })
    expect(bare.status).toBe(403)
  })

  test('CORS allows the web apps, with credentials', async () => {
    const { app } = await import('../src/app')
    const preflight = await app.request('/auth/login', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5174', 'Access-Control-Request-Method': 'POST' }
    })
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:5174')
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true')
    const other = await app.request('/health', { headers: { Origin: 'https://evil.example' } })
    expect(other.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('sign-up and profile', () => {
  test('sign-up creates a fleet owner, even if asked for government', async () => {
    const b = browser()
    const result = await b.call('POST', '/auth/signup', {
      role: 'govt',
      fullName: 'New Owner',
      username: 'new.owner',
      password: PASSWORD
    })
    expect(result.body.user).toMatchObject({ role: 'owner', isAdmin: false })
    const taken = await browser().call('POST', '/auth/signup', {
      fullName: 'Again',
      username: 'new.owner',
      password: PASSWORD
    })
    expect(taken).toMatchObject({ status: 409, body: { ok: false, error: 'username_taken' } })

    const profile = await b.call('PATCH', '/auth/profile', {
      fullName: 'Renamed',
      phone: '',
      companyName: 'Co',
      address: 'Khartoum',
      tin: '1'
    })
    expect(profile.body.user).toMatchObject({ fullName: 'Renamed', companyName: 'Co' })
  })

  test('government accounts have no profile route', async () => {
    await createAccount('govt.one', 'govt')
    const b = browser()
    await b.call('POST', '/auth/login', { username: 'govt.one', password: PASSWORD })
    const result = await b.call('PATCH', '/auth/profile', { fullName: 'x' })
    expect(result.status).toBe(403)
  })
})

describe('government users', () => {
  async function admin(): Promise<{ b: ReturnType<typeof browser>; id: number }> {
    const id = await createAccount('chief', 'govt', { isAdmin: true })
    const b = browser('http://localhost:5174')
    await b.call('POST', '/auth/login', { username: 'chief', password: PASSWORD })
    return { b, id }
  }

  test('only admins reach the routes', async () => {
    await createAccount('clerk', 'govt')
    const clerk = browser()
    await clerk.call('POST', '/auth/login', { username: 'clerk', password: PASSWORD })
    expect((await clerk.call('GET', '/govt/users')).status).toBe(403)
    expect((await browser().call('GET', '/govt/users')).status).toBe(401)
  })

  test('a new account must change its temporary password first', async () => {
    const { b } = await admin()
    const created = await b.call('POST', '/govt/users', {
      username: 'new.clerk',
      fullName: 'New Clerk'
    })
    expect(created.status).toBe(200)
    const { temporaryPassword, user } = created.body.data
    expect(temporaryPassword).toMatch(/^[A-Za-z2-9]{12}$/)
    expect(user).toMatchObject({ isAdmin: false, mustChangePassword: true, disabled: false })

    const clerk = browser()
    const login = await clerk.call('POST', '/auth/login', {
      username: 'new.clerk',
      password: temporaryPassword
    })
    expect(login.body.user.mustChangePassword).toBe(true)
    expect((await clerk.call('GET', '/auth/me')).status).toBe(200)
    expect(await clerk.call('GET', '/govt/users')).toMatchObject({
      status: 403,
      body: { ok: false, error: 'password_change_required' }
    })

    const same = await clerk.call('POST', '/auth/change-password', {
      currentPassword: temporaryPassword,
      newPassword: temporaryPassword
    })
    expect(same.body.error).toBe('same_password')
    const changed = await clerk.call('POST', '/auth/change-password', {
      currentPassword: temporaryPassword,
      newPassword: 'my-own-password'
    })
    expect(changed.body.user.mustChangePassword).toBe(false)
    // Still signed in after the change
    expect((await clerk.call('GET', '/auth/me')).status).toBe(200)
  })

  test('disabling an account ends its sessions at once', async () => {
    const { b } = await admin()
    const clerkId = await createAccount('clerk', 'govt')
    const clerk = browser()
    await clerk.call('POST', '/auth/login', { username: 'clerk', password: PASSWORD })
    expect((await clerk.call('GET', '/auth/me')).status).toBe(200)

    const disabled = await b.call('POST', `/govt/users/${clerkId}/disable`)
    expect(disabled.body.data.disabled).toBe(true)
    expect((await clerk.call('GET', '/auth/me')).status).toBe(401)
    expect((await b.call('POST', `/govt/users/${clerkId}/enable`)).body.data.disabled).toBe(false)
  })

  test('reset password signs the user out and forces a change', async () => {
    const { b } = await admin()
    const clerkId = await createAccount('clerk', 'govt')
    const clerk = browser()
    await clerk.call('POST', '/auth/login', { username: 'clerk', password: PASSWORD })
    const reset = await b.call('POST', `/govt/users/${clerkId}/reset-password`)
    expect(reset.body.data.user.mustChangePassword).toBe(true)
    expect((await clerk.call('GET', '/auth/me')).status).toBe(401)
    const old = await browser().call('POST', '/auth/login', {
      username: 'clerk',
      password: PASSWORD
    })
    expect(old.body.error).toBe('invalid_credentials')
  })

  test('the last active admin stays, and admins cannot change themselves', async () => {
    const { b, id } = await admin()
    const otherId = await createAccount('deputy', 'govt')
    expect((await b.call('POST', `/govt/users/${id}/disable`)).body.error).toBe(
      'cannot_change_self'
    )
    expect((await b.call('POST', `/govt/users/${id}/admin`, { isAdmin: false })).body.error).toBe(
      'cannot_change_self'
    )

    // Promote the deputy, who then demotes the chief: allowed, one admin is left
    expect(
      (await b.call('POST', `/govt/users/${otherId}/admin`, { isAdmin: true })).body.data.isAdmin
    ).toBe(true)
    const deputy = browser()
    await deputy.call('POST', '/auth/login', { username: 'deputy', password: PASSWORD })
    expect((await deputy.call('POST', `/govt/users/${id}/admin`, { isAdmin: false })).status).toBe(
      200
    )

    // The chief is no longer an admin, so the deputy is the last one
    const chief = await b.call('GET', '/govt/users')
    expect(chief.status).toBe(403)
  })

  test('two admins demoting each other at once leave one admin', async () => {
    const chiefId = await createAccount('chief', 'govt', { isAdmin: true })
    const deputyId = await createAccount('deputy', 'govt', { isAdmin: true })
    const results = await Promise.all([
      setAdmin(chiefId, deputyId, false),
      setAdmin(deputyId, chiefId, false)
    ])
    expect(results.map((r) => (r.ok ? 'ok' : r.error)).sort()).toEqual(['last_admin', 'ok'])
    const admins = await getDb().select().from(users).where(eq(users.isAdmin, true))
    expect(admins).toHaveLength(1)
  })

  test('a disabled admin does not count as the remaining one', async () => {
    const chiefId = await createAccount('chief', 'govt', { isAdmin: true })
    const deputyId = await createAccount('deputy', 'govt', {
      isAdmin: true,
      disabledAt: new Date()
    })
    // Acting as the (disabled) deputy, as a request already past the admin check would
    expect(await setAdmin(deputyId, chiefId, false)).toEqual({ ok: false, error: 'last_admin' })
    expect(await setDisabled(deputyId, chiefId, true)).toEqual({ ok: false, error: 'last_admin' })
  })

  test('owners are not government users', async () => {
    const { b } = await admin()
    const ownerId = await createAccount('owner.one', 'owner')
    expect((await b.call('POST', `/govt/users/${ownerId}/disable`)).status).toBe(404)
    const list = await b.call('GET', '/govt/users')
    expect(list.body.data.map((u: { username: string }) => u.username)).toEqual(['chief'])
  })
})
