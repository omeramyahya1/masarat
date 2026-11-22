// The people who sign in, their roles and a company's branches, managed from the portals: a
// company admin manages their company's (Team, Roles, Branches), a government admin the
// government's (Users). Both sides share these types and the rules in services/members.ts.
import type { BranchSummary } from './auth'
import type { CompanyPermission, Permission, RoleScope, RoleSummary } from './permissions'

export interface MemberRecord {
  id: number
  username: string
  fullName: string
  phone: string
  role: RoleSummary
  // Set when the role is branch-scoped
  branch: BranchSummary | null
  // Disabled accounts can't log in; their history stays
  disabled: boolean
  mustChangePassword: boolean
  createdAt: number
}

export interface NewMemberInput {
  username: string
  fullName: string
  // A Sudanese mobile number, required
  phone: string
  roleId: number
  // Required for a branch-scoped role, ignored otherwise
  branchId?: number | null
}

export interface MemberRoleInput {
  roleId: number
  branchId?: number | null
}

// What an admin gets back when creating an account or resetting its password: the temporary
// password, shown once, that the user replaces at their first login
export interface IssuedPassword {
  user: MemberRecord
  temporaryPassword: string
}

export interface RoleRecord extends RoleSummary {
  // The built-in company admin (and the government's roles) can't be edited
  locked: boolean
  permissions: Permission[]
  // Members with this role; a role in use can't be deleted or change scope
  memberCount: number
}

// A company's own role, or a change to an editable one
export interface RoleInput {
  name: string
  scope: RoleScope
  permissions: CompanyPermission[]
}

export interface BranchRecord extends BranchSummary {
  memberCount: number
  tripCount: number
}

export interface BranchInput {
  name: string
  cityId: number
  active?: boolean
}

export const MAX_ROLE_NAME_LENGTH = 60
export const MAX_BRANCH_NAME_LENGTH = 80

export type MemberErrorCode =
  | 'missing_fields'
  | 'invalid_username'
  | 'username_taken'
  | 'invalid_phone'
  | 'phone_taken'
  | 'user_not_found'
  // The action would leave no active admin
  | 'last_admin'
  // Admins can't disable, reassign or reset themselves here
  | 'cannot_change_self'
  | 'role_not_found'
  | 'role_locked'
  | 'role_in_use'
  | 'role_name_taken'
  | 'invalid_role'
  // A branch-scoped role needs an active branch of the company
  | 'branch_required'
  | 'branch_not_found'
  | 'branch_name_taken'
  | 'city_not_found'
  | 'not_signed_in'
  | 'forbidden'
  | 'password_change_required'
  | 'unknown'

export type MemberResult<T> = { ok: true; data: T } | { ok: false; error: MemberErrorCode }
