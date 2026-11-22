// Who may do what. Every account belongs to a transport company or to the government, and has one
// role; a role is a set of the permissions below. The lists are the single source for the API's
// checks (requirePermission), the database's CHECK on role_permissions, and the portals (useCan).
//
// A role's scope decides how far it reaches inside a company: a "branch" role (a clerk at a booth)
// sees and books the trips of its member's branch only; a "company" role sees every branch.

export const USER_KINDS = ['company', 'govt'] as const
export type UserKind = (typeof USER_KINDS)[number]

export const COMPANY_PERMISSIONS = [
  'trips.view',
  // Create, edit and delete draft trips
  'trips.edit',
  // Generate the bill ID and refresh its payment
  'trips.bill',
  // Book a passenger trip from a saved template, and keep the templates
  'templates.use',
  'templates.manage',
  'fleet.view',
  'fleet.manage',
  'drivers.view',
  'drivers.manage',
  // The company's name, address and TIN (printed on its manifests as the carrier)
  'company.profile',
  'branches.manage',
  'members.manage',
  'roles.manage'
] as const
export type CompanyPermission = (typeof COMPANY_PERMISSIONS)[number]

export const GOVT_PERMISSIONS = [
  'govt.dashboard',
  'govt.search',
  'govt.exports',
  // The taxes and fees
  'govt.charges',
  // The validity margin and average speeds (Settings)
  'govt.settings',
  'govt.users'
] as const
export type GovtPermission = (typeof GOVT_PERMISSIONS)[number]

export const PERMISSIONS = [...COMPANY_PERMISSIONS, ...GOVT_PERMISSIONS] as const
export type Permission = (typeof PERMISSIONS)[number]

export const isPermission = (value: unknown): value is Permission =>
  PERMISSIONS.includes(value as Permission)
export const isCompanyPermission = (value: unknown): value is CompanyPermission =>
  COMPANY_PERMISSIONS.includes(value as CompanyPermission)

// Doing something implies seeing it: ticking "Manage vehicles" also ticks "View vehicles"
const IMPLIES: Partial<Record<Permission, readonly Permission[]>> = {
  'trips.edit': ['trips.view'],
  'trips.bill': ['trips.view'],
  'templates.use': ['trips.edit'],
  'templates.manage': ['templates.use'],
  'fleet.manage': ['fleet.view'],
  'drivers.manage': ['drivers.view']
}

// The permissions with everything they imply, in the lists' order
export function withImplied<P extends Permission>(permissions: Iterable<P>): P[] {
  const set = new Set<Permission>(permissions)
  // Follows the chain: managing templates implies using them, which implies booking trips, …
  const queue = [...set]
  for (let permission = queue.pop(); permission; permission = queue.pop()) {
    for (const implied of IMPLIES[permission] ?? []) {
      if (!set.has(implied)) {
        set.add(implied)
        queue.push(implied)
      }
    }
  }
  return PERMISSIONS.filter((p) => set.has(p)) as P[]
}

// The company permissions grouped as the role editor shows them
export const COMPANY_PERMISSION_GROUPS: Record<string, readonly CompanyPermission[]> = {
  trips: ['trips.view', 'trips.edit', 'trips.bill', 'templates.use', 'templates.manage'],
  fleet: ['fleet.view', 'fleet.manage', 'drivers.view', 'drivers.manage'],
  company: ['company.profile', 'branches.manage', 'members.manage', 'roles.manage']
}

export const ROLE_SCOPES = ['branch', 'company'] as const
export type RoleScope = (typeof ROLE_SCOPES)[number]

// The roles every company starts with, and the government's two
export const BUILTIN_ROLE_KEYS = [
  'company_admin',
  'clerk',
  'accountant',
  'govt_admin',
  'govt_agent'
] as const
export type BuiltinRoleKey = (typeof BUILTIN_ROLE_KEYS)[number]

export const COMPANY_ROLE_KEYS = ['company_admin', 'clerk', 'accountant'] as const
export const GOVT_ROLE_KEYS = ['govt_admin', 'govt_agent'] as const

// Roles nobody can edit: their permissions come from here, not the database, so a permission
// added later reaches them at once
export const LOCKED_ROLE_KEYS: readonly BuiltinRoleKey[] = [
  'company_admin',
  'govt_admin',
  'govt_agent'
]

export const BUILTIN_ROLES: Record<
  BuiltinRoleKey,
  { kind: UserKind; scope: RoleScope; permissions: readonly Permission[] }
> = {
  company_admin: { kind: 'company', scope: 'company', permissions: COMPANY_PERMISSIONS },
  // Books trips at their own branch and bills them
  clerk: {
    kind: 'company',
    scope: 'branch',
    permissions: ['trips.view', 'trips.edit', 'trips.bill', 'templates.use']
  },
  // Follows every branch's trips and bills
  accountant: {
    kind: 'company',
    scope: 'company',
    permissions: ['trips.view', 'trips.bill', 'fleet.view', 'drivers.view']
  },
  govt_admin: { kind: 'govt', scope: 'company', permissions: GOVT_PERMISSIONS },
  govt_agent: {
    kind: 'govt',
    scope: 'company',
    permissions: ['govt.dashboard', 'govt.search', 'govt.exports']
  }
}

export const isBuiltinRoleKey = (value: unknown): value is BuiltinRoleKey =>
  BUILTIN_ROLE_KEYS.includes(value as BuiltinRoleKey)

// A role as the signed-in user and the role lists see it
export interface RoleSummary {
  id: number
  // Set for the built-in roles, whose names the portals translate; null for a company's own roles
  key: BuiltinRoleKey | null
  name: string
  scope: RoleScope
}
