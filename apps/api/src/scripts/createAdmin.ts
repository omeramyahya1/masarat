// The government admin, from the server's shell. There is exactly one (migration 0010):
//   bun run user:create-admin <username> <phone> "<full name>"
// Prints a temporary password, which the admin replaces at their first login. The admin then
// creates the other government accounts from the Government portal (Users).
//
// In production (APP_ENV=production, which deployment uses) it only creates the admin when there
// is none: replacing the admin means removing the current one by hand first (docs/deployment). In
// development it upserts: an existing admin gets the given username, phone and name, a new
// temporary password, is enabled again and is signed out everywhere.
import { and, eq, isNull, ne } from 'drizzle-orm'
import { USERNAME_PATTERN } from '@masarat/shared/auth'
import { config } from '../config'
import { closeDb, getDb, roles, users } from '../db'
import { accountPhone, hashPassword } from '../services/auth'
import { createMember, temporaryPassword } from '../services/members'
import { deleteUserSessions } from '../services/sessions'

type Outcome =
  | { ok: true; action: 'created' | 'updated'; username: string; password: string }
  | { ok: false; message: string }

export async function createOrUpdateAdmin(
  usernameInput: string,
  phoneInput: string,
  fullNameInput: string,
  // Production refuses to replace an existing admin (a parameter so the tests can say which)
  production: boolean = config.production
): Promise<Outcome> {
  const db = getDb()
  const [adminRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(isNull(roles.companyId), eq(roles.key, 'govt_admin')))
    .limit(1)
  const [existing] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.roleId, adminRole.id))
    .limit(1)

  if (!existing) {
    const result = await createMember(
      { kind: 'govt' },
      { username: usernameInput, phone: phoneInput, fullName: fullNameInput, roleId: adminRole.id }
    )
    if (!result.ok) return { ok: false, message: `Not created: ${result.error}` }
    return {
      ok: true,
      action: 'created',
      username: result.data.user.username,
      password: result.data.temporaryPassword
    }
  }

  if (production) {
    return {
      ok: false,
      message:
        `A government admin already exists (${existing.username}). There can only be one: remove ` +
        'it by hand first (see docs/deployment/predeployment-checklist.md), then run this again.'
    }
  }

  // Development: the existing admin takes the given details
  const username = usernameInput.trim().toLowerCase()
  const fullName = fullNameInput.trim()
  if (!USERNAME_PATTERN.test(username))
    return { ok: false, message: 'Not updated: invalid_username' }
  const phone = accountPhone(phoneInput)
  if (!phone) return { ok: false, message: 'Not updated: invalid_phone' }
  const [clash] = await db
    .select({ username: users.username, phone: users.phone })
    .from(users)
    .where(and(ne(users.id, existing.id), eq(users.username, username)))
    .limit(1)
  if (clash) return { ok: false, message: 'Not updated: username_taken' }
  const [phoneClash] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(ne(users.id, existing.id), eq(users.phone, phone)))
    .limit(1)
  if (phoneClash) return { ok: false, message: 'Not updated: phone_taken' }

  const password = temporaryPassword()
  await db
    .update(users)
    .set({
      username,
      phone,
      fullName,
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
      disabledAt: null
    })
    .where(eq(users.id, existing.id))
  await deleteUserSessions(existing.id)
  return { ok: true, action: 'updated', username, password }
}

if (import.meta.main) {
  const [username, phone, ...name] = process.argv.slice(2)
  if (!username || !phone || name.length === 0) {
    console.error('Usage: bun run user:create-admin <username> <phone> "<full name>"')
    process.exit(1)
  }
  const outcome = await createOrUpdateAdmin(username, phone, name.join(' '))
  await closeDb()
  if (!outcome.ok) {
    console.error(outcome.message)
    process.exit(1)
  }
  console.log(
    `${outcome.action === 'created' ? 'Created' : 'Updated'} government admin ${outcome.username}`
  )
  console.log(`Temporary password: ${outcome.password}`)
}
