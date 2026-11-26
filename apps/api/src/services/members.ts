// The accounts an admin manages: a company admin their company's members (Team), a government
// admin the government's users (Users). Create (with a temporary password), disable or enable,
// reset the password, and change the role (and branch). There is always at least one active admin
// on each side, and an admin can't change their own account here. The routes check the
// permission; these functions check the rest.
import { randomInt } from 'crypto'
import { and, asc, count, eq, inArray, isNull, ne, type SQL } from 'drizzle-orm'
import {
  branches,
  getDb,
  isUniqueViolation,
  roles,
  users,
  type Branch,
  type Role,
  type User
} from '../db'
import { USERNAME_PATTERN } from '@masarat/shared/auth'
import type {
  IssuedPassword,
  MemberErrorCode,
  MemberRecord,
  MemberResult,
  MemberRoleInput,
  NewMemberInput
} from '@masarat/shared/members'
import { toBranchSummary, toRoleSummary } from './access'
import { accountPhone, hashPassword, isPhoneConflict, phoneTaken } from './auth'
import type { Tx } from './companies'
import { deleteUserSessions } from './sessions'

// Whose accounts: one company's, or the government's
export type Side = { kind: 'company'; companyId: number } | { kind: 'govt' }

const ADMIN_KEY = { company: 'company_admin', govt: 'govt_admin' } as const

const toRecord = (user: User, role: Role, branch: Branch | null): MemberRecord => ({
  id: user.id,
  username: user.username,
  fullName: user.fullName,
  phone: user.phone,
  role: toRoleSummary(role),
  branch: role.scope === 'branch' && branch ? toBranchSummary(branch) : null,
  disabled: user.disabledAt !== null,
  mustChangePassword: user.mustChangePassword,
  createdAt: user.createdAt.getTime()
})

const sideUsers = (side: Side): SQL | undefined =>
  side.kind === 'company'
    ? and(eq(users.kind, 'company'), eq(users.companyId, side.companyId))
    : eq(users.kind, 'govt')

const sideRoles = (side: Side): SQL =>
  side.kind === 'company' ? eq(roles.companyId, side.companyId) : isNull(roles.companyId)

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

// 12 characters without look-alikes (0/O, 1/l/I), read out or copied to the new user
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function temporaryPassword(length = 12): string {
  return Array.from({ length }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join(
    ''
  )
}

async function recordOf(userId: number): Promise<MemberRecord> {
  const [row] = await getDb()
    .select({ user: users, role: roles, branch: branches })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .leftJoin(branches, eq(users.branchId, branches.id))
    .where(eq(users.id, userId))
    .limit(1)
  return toRecord(row.user, row.role, row.branch)
}

export async function listMembers(side: Side): Promise<MemberRecord[]> {
  const rows = await getDb()
    .select({ user: users, role: roles, branch: branches })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .leftJoin(branches, eq(users.branchId, branches.id))
    .where(sideUsers(side))
    .orderBy(asc(users.fullName), asc(users.id))
  return rows.map((row) => toRecord(row.user, row.role, row.branch))
}

// The role (one of this side's) and, for a branch role, the branch (an active one of the company).
// Run inside the transaction that writes the user: the role row stays locked until then, so its
// scope can't change in between (updateRole takes the same lock).
async function checkAssignment(
  db: Tx,
  side: Side,
  input: MemberRoleInput,
  // The account being changed (null for a new one)
  userId: number | null = null
): Promise<
  { ok: true; role: Role; branchId: number | null } | { ok: false; error: MemberErrorCode }
> {
  const roleId = Number(input?.roleId)
  if (!Number.isInteger(roleId)) return { ok: false, error: 'role_not_found' }
  const [role] = await db
    .select()
    .from(roles)
    .where(and(eq(roles.id, roleId), sideRoles(side)))
    .for('update')
  if (!role) return { ok: false, error: 'role_not_found' }
  // There is one government admin (migration 0010's index): the role can't go to anyone else
  if (side.kind === 'govt' && role.key === ADMIN_KEY.govt) {
    const [holder] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.roleId, role.id), userId === null ? undefined : ne(users.id, userId)))
      .limit(1)
    if (holder) return { ok: false, error: 'admin_exists' }
  }
  if (role.scope !== 'branch' || side.kind !== 'company') return { ok: true, role, branchId: null }

  const branchId = Number(input?.branchId)
  if (!input?.branchId || !Number.isInteger(branchId))
    return { ok: false, error: 'branch_required' }
  const [branch] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(
      and(
        eq(branches.id, branchId),
        eq(branches.companyId, side.companyId),
        eq(branches.active, true)
      )
    )
    .limit(1)
  if (!branch) return { ok: false, error: 'branch_not_found' }
  return { ok: true, role, branchId }
}

export async function createMember(
  side: Side,
  input: NewMemberInput
): Promise<MemberResult<IssuedPassword>> {
  const fullName = asText(input?.fullName)
  const username = asText(input?.username).toLowerCase()
  if (!fullName || !username || !asText(input?.phone)) return { ok: false, error: 'missing_fields' }
  if (!USERNAME_PATTERN.test(username)) return { ok: false, error: 'invalid_username' }
  const phone = accountPhone(input.phone)
  if (!phone) return { ok: false, error: 'invalid_phone' }
  if (await phoneTaken(phone)) return { ok: false, error: 'phone_taken' }

  const password = temporaryPassword()
  const passwordHash = await hashPassword(password)
  let result: MemberResult<User | null>
  try {
    result = await getDb().transaction(async (tx) => {
      const assignment = await checkAssignment(tx, side, input)
      if (!assignment.ok) return assignment
      const [created] = await tx
        .insert(users)
        .values({
          kind: side.kind,
          companyId: side.kind === 'company' ? side.companyId : null,
          roleId: assignment.role.id,
          branchId: assignment.branchId,
          username,
          fullName,
          phone,
          passwordHash,
          mustChangePassword: true
        })
        .onConflictDoNothing({ target: users.username })
        .returning()
      return { ok: true, data: created ?? null }
    })
  } catch (error) {
    if (isPhoneConflict(error)) return { ok: false, error: 'phone_taken' }
    if (isUniqueViolation(error, 'users_one_govt_admin_idx'))
      return { ok: false, error: 'admin_exists' }
    throw error
  }
  if (!result.ok) return result
  if (!result.data) return { ok: false, error: 'username_taken' }
  return { ok: true, data: { user: await recordOf(result.data.id), temporaryPassword: password } }
}

// The side's admin role ids
async function adminRoleIds(tx: Tx, side: Side): Promise<number[]> {
  const rows = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(sideRoles(side), eq(roles.key, ADMIN_KEY[side.kind])))
  return rows.map((r) => r.id)
}

// Whether an active admin other than this user remains
async function otherActiveAdmin(tx: Tx, side: Side, userId: number): Promise<boolean> {
  const adminRoles = await adminRoleIds(tx, side)
  const [row] = await tx
    .select({ value: count() })
    .from(users)
    .where(
      and(
        sideUsers(side),
        inArray(users.roleId, adminRoles),
        isNull(users.disabledAt),
        ne(users.id, userId)
      )
    )
  return (row?.value ?? 0) > 0
}

// Runs a change to another account of the side. The side's admins are locked first, so two admins
// demoting or disabling each other at once can't leave nobody in charge.
async function changeAccount(
  side: Side,
  adminId: number,
  userId: number,
  change: (tx: Tx, user: User, isAdmin: boolean) => Promise<MemberResult<null>>
): Promise<MemberResult<null>> {
  if (userId === adminId) return { ok: false, error: 'cannot_change_self' }
  return getDb().transaction(async (tx) => {
    const adminRoles = await adminRoleIds(tx, side)
    await tx
      .select({ id: users.id })
      .from(users)
      .where(and(sideUsers(side), inArray(users.roleId, adminRoles)))
      .for('update')
    const [user] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, userId), sideUsers(side)))
      .for('update')
    if (!user) return { ok: false, error: 'user_not_found' }
    return change(tx, user, adminRoles.includes(user.roleId))
  })
}

export async function setDisabled(
  side: Side,
  adminId: number,
  userId: number,
  disabled: boolean
): Promise<MemberResult<MemberRecord>> {
  const result = await changeAccount(side, adminId, userId, async (tx, user, isAdmin) => {
    if (disabled && isAdmin && !(await otherActiveAdmin(tx, side, user.id))) {
      return { ok: false, error: 'last_admin' }
    }
    const disabledAt = disabled ? (user.disabledAt ?? new Date()) : null
    await tx.update(users).set({ disabledAt }).where(eq(users.id, user.id))
    return { ok: true, data: null }
  })
  if (!result.ok) return result
  // A disabled account is signed out everywhere at once
  if (disabled) await deleteUserSessions(userId)
  return { ok: true, data: await recordOf(userId) }
}

export async function changeRole(
  side: Side,
  adminId: number,
  userId: number,
  input: MemberRoleInput
): Promise<MemberResult<MemberRecord>> {
  const result = await changeAccount(side, adminId, userId, async (tx, user, isAdmin) => {
    const assignment = await checkAssignment(tx, side, input, user.id)
    if (!assignment.ok) return assignment
    const staysAdmin = assignment.role.key === ADMIN_KEY[side.kind]
    if (isAdmin && !staysAdmin && !(await otherActiveAdmin(tx, side, user.id))) {
      return { ok: false, error: 'last_admin' }
    }
    await tx
      .update(users)
      .set({ roleId: assignment.role.id, branchId: assignment.branchId })
      .where(eq(users.id, user.id))
    return { ok: true, data: null }
  })
  return result.ok ? { ok: true, data: await recordOf(userId) } : result
}

// A new temporary password; the user is signed out and has to replace it at their next login
export async function resetPassword(
  side: Side,
  adminId: number,
  userId: number
): Promise<MemberResult<IssuedPassword>> {
  const password = temporaryPassword()
  const passwordHash = await hashPassword(password)
  const result = await changeAccount(side, adminId, userId, async (tx, user) => {
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword: true })
      .where(eq(users.id, user.id))
    return { ok: true, data: null }
  })
  if (!result.ok) return result
  await deleteUserSessions(userId)
  return { ok: true, data: { user: await recordOf(userId), temporaryPassword: password } }
}
