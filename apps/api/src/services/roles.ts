// Roles: the government's two are fixed; a company has its built-in three (the company admin
// locked, the clerk and accountant editable) and any it makes itself, each a name, a scope and a
// set of permissions ticked in the Roles section.
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm'
import { getDb, isUniqueViolation, rolePermissions, roles, users, type Role } from '../db'
import {
  MAX_ROLE_NAME_LENGTH,
  type MemberResult,
  type RoleInput,
  type RoleRecord
} from '@masarat/shared/members'
import {
  ROLE_SCOPES,
  isCompanyPermission,
  withImplied,
  type CompanyPermission,
  type RoleScope
} from '@masarat/shared/permissions'
import { isLockedRole, permissionsOf, toRoleSummary } from './access'
import type { Side } from './members'

async function toRecord(role: Role, memberCount: number): Promise<RoleRecord> {
  return {
    ...toRoleSummary(role),
    locked: isLockedRole(role),
    permissions: await permissionsOf(role),
    memberCount
  }
}

export async function listRoles(side: Side): Promise<RoleRecord[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(roles)
    .where(side.kind === 'company' ? eq(roles.companyId, side.companyId) : isNull(roles.companyId))
    .orderBy(asc(roles.id))
  const counts = rows.length
    ? await db
        .select({ roleId: users.roleId, value: count() })
        .from(users)
        .where(
          inArray(
            users.roleId,
            rows.map((r) => r.id)
          )
        )
        .groupBy(users.roleId)
    : []
  const countOf = new Map(counts.map((c) => [c.roleId, c.value]))
  return Promise.all(rows.map((role) => toRecord(role, countOf.get(role.id) ?? 0)))
}

// Input comes from the browser, so treat every field as untrusted
function validate(
  input: RoleInput
):
  | { ok: true; name: string; scope: RoleScope; permissions: CompanyPermission[] }
  | { ok: false; error: 'missing_fields' | 'invalid_role' } {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!name) return { ok: false, error: 'missing_fields' }
  const scope = input?.scope
  const raw = Array.isArray(input?.permissions) ? input.permissions : []
  if (
    name.length > MAX_ROLE_NAME_LENGTH ||
    !ROLE_SCOPES.includes(scope) ||
    raw.length === 0 ||
    !raw.every(isCompanyPermission)
  ) {
    return { ok: false, error: 'invalid_role' }
  }
  return { ok: true, name, scope, permissions: withImplied(raw) }
}

const isNameTaken = (error: unknown): boolean =>
  isUniqueViolation(error, 'roles_company_name_unique')

async function membersOf(roleId: number): Promise<number> {
  const [row] = await getDb().select({ value: count() }).from(users).where(eq(users.roleId, roleId))
  return row?.value ?? 0
}

async function findCompanyRole(companyId: number, roleId: number): Promise<Role | undefined> {
  const [role] = await getDb()
    .select()
    .from(roles)
    .where(and(eq(roles.id, roleId), eq(roles.companyId, companyId)))
    .limit(1)
  return role
}

export async function createRole(
  companyId: number,
  input: RoleInput
): Promise<MemberResult<RoleRecord>> {
  const checked = validate(input)
  if (!checked.ok) return checked
  try {
    const role = await getDb().transaction(async (tx) => {
      const [created] = await tx
        .insert(roles)
        .values({ companyId, name: checked.name, scope: checked.scope })
        .returning()
      await tx
        .insert(rolePermissions)
        .values(checked.permissions.map((permission) => ({ roleId: created.id, permission })))
      return created
    })
    return { ok: true, data: await toRecord(role, 0) }
  } catch (error) {
    if (isNameTaken(error)) return { ok: false, error: 'role_name_taken' }
    throw error
  }
}

export async function updateRole(
  companyId: number,
  roleId: number,
  input: RoleInput
): Promise<MemberResult<RoleRecord>> {
  const existing = await findCompanyRole(companyId, roleId)
  if (!existing) return { ok: false, error: 'role_not_found' }
  if (isLockedRole(existing)) return { ok: false, error: 'role_locked' }
  const checked = validate(input)
  if (!checked.ok) return checked
  const members = await membersOf(roleId)
  // Members of a branch role have a branch, those of a company role don't: reassign them first
  if (checked.scope !== existing.scope && members > 0) return { ok: false, error: 'role_in_use' }
  try {
    const role = await getDb().transaction(async (tx) => {
      const [updated] = await tx
        .update(roles)
        .set({ name: checked.name, scope: checked.scope })
        .where(eq(roles.id, roleId))
        .returning()
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId))
      await tx
        .insert(rolePermissions)
        .values(checked.permissions.map((permission) => ({ roleId, permission })))
      return updated
    })
    return { ok: true, data: await toRecord(role, members) }
  } catch (error) {
    if (isNameTaken(error)) return { ok: false, error: 'role_name_taken' }
    throw error
  }
}

// A company's own role nobody has; the built-in ones stay
export async function deleteRole(companyId: number, roleId: number): Promise<MemberResult<null>> {
  const existing = await findCompanyRole(companyId, roleId)
  if (!existing) return { ok: false, error: 'role_not_found' }
  if (existing.key !== null) return { ok: false, error: 'role_locked' }
  if ((await membersOf(roleId)) > 0) return { ok: false, error: 'role_in_use' }
  await getDb().delete(roles).where(eq(roles.id, roleId))
  return { ok: true, data: null }
}
