// The signed-in account as the rest of the API sees it: its company, role, branch and permissions,
// loaded with every request (services/sessions.ts finds the user, the session middleware calls
// accountOf). The scope helpers turn it into what the trip services filter by.
import { and, eq, type SQL } from 'drizzle-orm'
import {
  branches,
  companies,
  getDb,
  manifests,
  rolePermissions,
  roles,
  users,
  vehicles,
  type User
} from '../db'
import type { AuthUser, BranchSummary, CompanyProfile } from '@masarat/shared/auth'
import {
  BUILTIN_ROLES,
  LOCKED_ROLE_KEYS,
  isPermission,
  withImplied,
  type Permission,
  type RoleSummary
} from '@masarat/shared/permissions'
import type { Branch, Company, Role } from '../db'

export const toCompanyProfile = (company: Company): CompanyProfile => ({
  id: company.id,
  name: company.name,
  address: company.address,
  tin: company.tin
})

export const toBranchSummary = (branch: Branch): BranchSummary => ({
  id: branch.id,
  name: branch.name,
  cityId: branch.cityId,
  active: branch.active
})

export const toRoleSummary = (role: Role): RoleSummary => ({
  id: role.id,
  key: role.key,
  name: role.name,
  scope: role.scope
})

export const isLockedRole = (role: Pick<Role, 'key'>): boolean =>
  role.key !== null && LOCKED_ROLE_KEYS.includes(role.key)

// A role's permissions: a locked built-in role's from the code, any other's from role_permissions
export async function permissionsOf(role: Role): Promise<Permission[]> {
  if (role.key !== null && isLockedRole(role)) return [...BUILTIN_ROLES[role.key].permissions]
  const rows = await getDb()
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, role.id))
  return withImplied(rows.map((r) => r.permission).filter(isPermission))
}

export async function accountOf(user: User): Promise<AuthUser> {
  const [row] = await getDb()
    .select({ role: roles, company: companies, branch: branches })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .leftJoin(companies, eq(users.companyId, companies.id))
    .leftJoin(branches, eq(users.branchId, branches.id))
    .where(eq(users.id, user.id))
    .limit(1)
  const permissions = await permissionsOf(row.role)
  return {
    id: user.id,
    username: user.username,
    kind: user.kind,
    fullName: user.fullName,
    phone: user.phone,
    company: row.company ? toCompanyProfile(row.company) : null,
    role: toRoleSummary(row.role),
    branch: row.role.scope === 'branch' && row.branch ? toBranchSummary(row.branch) : null,
    // A role of the other side can't grant anything here (the CHECKs and services prevent it)
    permissions: permissions.filter((p) => p.startsWith('govt.') === (user.kind === 'govt')),
    mustChangePassword: user.mustChangePassword
  }
}

export async function accountById(userId: number): Promise<AuthUser | null> {
  const [user] = await getDb().select().from(users).where(eq(users.id, userId)).limit(1)
  return user ? accountOf(user) : null
}

// What a company member sees: their company, and only their branch when their role is
// branch-scoped
export interface CompanyScope {
  companyId: number
  branchId: number | null
}

// The trip services take a company scope, or null for the government's read-only view of every
// company
export type TripScope = CompanyScope | null

export function scopeOf(account: AuthUser): CompanyScope {
  if (!account.company) throw new Error('Not a company account')
  // A branch-scoped member always has a branch (services/members.ts); 0 matches no trip
  const branchId = account.role.scope === 'branch' ? (account.branch?.id ?? 0) : null
  return { companyId: account.company.id, branchId }
}

// The trips a scope may see, as a condition on a query that joins manifests with their vehicles:
// the company's vehicles, and the member's branch when they're branch-scoped. Null (the
// government) sees every trip.
export function tripScopeCondition(scope: TripScope): SQL | undefined {
  if (scope === null) return undefined
  return and(
    eq(vehicles.companyId, scope.companyId),
    scope.branchId === null ? undefined : eq(manifests.branchId, scope.branchId)
  )
}
