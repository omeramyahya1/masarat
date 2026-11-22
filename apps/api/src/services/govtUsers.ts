// Government accounts, managed by government admins: create (with a temporary password), disable
// or enable, reset the password, and make or remove admins. There is always at least one active
// admin, and an admin can't change their own account here. The routes check that the caller is an
// admin; these functions check the rest.
import { randomInt } from 'crypto'
import { and, asc, count, eq, isNull, ne } from 'drizzle-orm'
import { getDb, users, type User } from '../db'
import { USERNAME_PATTERN } from '@masarat/shared/auth'
import type {
  GovtUserRecord,
  GovtUserResult,
  IssuedPassword,
  NewGovtUserInput
} from '@masarat/shared/govtUsers'
import { hashPassword } from './auth'
import { deleteUserSessions } from './sessions'

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

const toRecord = (user: User): GovtUserRecord => ({
  id: user.id,
  username: user.username,
  fullName: user.fullName,
  phone: user.phone,
  isAdmin: user.isAdmin,
  disabled: user.disabledAt !== null,
  mustChangePassword: user.mustChangePassword,
  createdAt: user.createdAt.getTime()
})

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

// 12 characters without look-alikes (0/O, 1/l/I), read out or copied to the new user
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function temporaryPassword(length = 12): string {
  return Array.from({ length }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join(
    ''
  )
}

export async function listGovtUsers(): Promise<GovtUserRecord[]> {
  const rows = await getDb()
    .select()
    .from(users)
    .where(eq(users.role, 'govt'))
    .orderBy(asc(users.fullName), asc(users.id))
  return rows.map(toRecord)
}

export async function createGovtUser(
  input: NewGovtUserInput
): Promise<GovtUserResult<IssuedPassword>> {
  const fullName = asText(input?.fullName)
  const username = asText(input?.username).toLowerCase()
  if (!fullName || !username) return { ok: false, error: 'missing_fields' }
  if (!USERNAME_PATTERN.test(username)) return { ok: false, error: 'invalid_username' }

  const password = temporaryPassword()
  const [created] = await getDb()
    .insert(users)
    .values({
      role: 'govt',
      username,
      fullName,
      phone: asText(input.phone) || null,
      isAdmin: input.isAdmin === true,
      passwordHash: await hashPassword(password),
      mustChangePassword: true
    })
    .onConflictDoNothing({ target: users.username })
    .returning()
  if (!created) return { ok: false, error: 'username_taken' }
  return { ok: true, data: { user: toRecord(created), temporaryPassword: password } }
}

// Runs a change to another government account. The admins are locked first, so two admins
// demoting or disabling each other at once can't leave nobody in charge.
async function changeAccount(
  adminId: number,
  userId: number,
  change: (tx: Tx, user: User) => Promise<GovtUserResult<User>>
): Promise<GovtUserResult<User>> {
  if (userId === adminId) return { ok: false, error: 'cannot_change_self' }
  return getDb().transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.isAdmin, true)).for('update')
    const [user] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.role, 'govt')))
      .for('update')
    if (!user) return { ok: false, error: 'user_not_found' }
    return change(tx, user)
  })
}

// Whether an active admin other than this user exists
async function otherActiveAdmin(tx: Tx, userId: number): Promise<boolean> {
  const [row] = await tx
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.isAdmin, true), isNull(users.disabledAt), ne(users.id, userId)))
  return (row?.value ?? 0) > 0
}

async function update(tx: Tx, userId: number, values: Partial<User>): Promise<User> {
  const [updated] = await tx.update(users).set(values).where(eq(users.id, userId)).returning()
  return updated
}

export async function setDisabled(
  adminId: number,
  userId: number,
  disabled: boolean
): Promise<GovtUserResult<GovtUserRecord>> {
  const result = await changeAccount(adminId, userId, async (tx, user) => {
    if (disabled && user.isAdmin && !(await otherActiveAdmin(tx, user.id))) {
      return { ok: false, error: 'last_admin' }
    }
    const disabledAt = disabled ? (user.disabledAt ?? new Date()) : null
    return { ok: true, data: await update(tx, user.id, { disabledAt }) }
  })
  if (!result.ok) return result
  // A disabled account is signed out everywhere at once
  if (disabled) await deleteUserSessions(userId)
  return { ok: true, data: toRecord(result.data) }
}

export async function setAdmin(
  adminId: number,
  userId: number,
  isAdmin: boolean
): Promise<GovtUserResult<GovtUserRecord>> {
  const result = await changeAccount(adminId, userId, async (tx, user) => {
    if (!isAdmin && user.isAdmin && !(await otherActiveAdmin(tx, user.id))) {
      return { ok: false, error: 'last_admin' }
    }
    return { ok: true, data: await update(tx, user.id, { isAdmin }) }
  })
  return result.ok ? { ok: true, data: toRecord(result.data) } : result
}

// A new temporary password; the user is signed out and has to replace it at their next login
export async function resetPassword(
  adminId: number,
  userId: number
): Promise<GovtUserResult<IssuedPassword>> {
  const password = temporaryPassword()
  const passwordHash = await hashPassword(password)
  const result = await changeAccount(adminId, userId, async (tx, user) => ({
    ok: true,
    data: await update(tx, user.id, { passwordHash, mustChangePassword: true })
  }))
  if (!result.ok) return result
  await deleteUserSessions(userId)
  return { ok: true, data: { user: toRecord(result.data), temporaryPassword: password } }
}
