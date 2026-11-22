// Types and rules shared by the API (auth services) and the web apps (auth forms)

import type { Permission, RoleSummary, UserKind } from './permissions'

// A transport company's own details. The name, address and TIN are printed on its manifests as
// the carrier.
export interface CompanyProfile {
  id: number
  name: string
  address: string | null
  // Tax Identification Number (الرقم الضريبي)
  tin: string | null
}

export interface BranchSummary {
  id: number
  name: string
  cityId: number
  active: boolean
}

export interface AuthUser {
  id: number
  username: string
  // Decides the portal: a company's members use the company portal, the government its own
  kind: UserKind
  fullName: string
  phone: string
  // The member's company; null for the government
  company: CompanyProfile | null
  role: RoleSummary
  // A branch-scoped member's branch (they see and book its trips only); null otherwise
  branch: BranchSummary | null
  // What the role allows (with the implied permissions), for showing only what the user can use.
  // The API checks every request itself.
  permissions: Permission[]
  // Set on an account an admin created or reset: it has to pick its own password first
  mustChangePassword: boolean
}

// Signing up creates a transport company and its first member, the company admin. Government
// accounts are created by a government admin.
export interface SignUpInput {
  fullName: string
  username: string
  password: string
  // A Sudanese mobile number, required (see phone.ts)
  phone: string
  companyName: string
  address?: string
  tin?: string
}

// Anyone's own details (Profile section)
export interface ProfileInput {
  fullName: string
  phone: string
}

// The company's details (Company section, `company.profile`)
export interface CompanyInput {
  name: string
  address: string
  tin: string
}

export interface LogInInput {
  username: string
  password: string
}

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

export type AuthErrorCode =
  | 'missing_fields'
  | 'invalid_username'
  | 'weak_password'
  | 'username_taken'
  | 'invalid_credentials'
  | 'too_many_attempts'
  | 'account_disabled'
  | 'wrong_password'
  | 'same_password'
  | 'password_change_required'
  | 'forbidden'
  | 'invalid_tin'
  | 'address_too_long'
  // Not a Sudanese mobile number, or another account has it
  | 'invalid_phone'
  | 'phone_taken'
  | 'not_signed_in'
  | 'unknown'

export type AuthResult = { ok: true; user: AuthUser } | { ok: false; error: AuthErrorCode }

// Usernames are stored lowercased
export const USERNAME_PATTERN = /^[a-z0-9_.]{3,32}$/
export const PASSWORD_MIN_LENGTH = 8
// Tax Identification Number (الرقم الضريبي): free text, at most this long
export const MAX_TIN_LENGTH = 30
export const MAX_ADDRESS_LENGTH = 200
