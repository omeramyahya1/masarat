// Types and rules shared by the API (auth services) and the web apps (auth forms)

export type UserRole = 'owner' | 'govt'

export interface AuthUser {
  id: number
  username: string
  role: UserRole
  fullName: string
  phone: string
  companyName: string | null
  // Fleet owners' carrier details, printed on their manifests
  address: string | null
  tin: string | null
  // Government accounts that manage the other government accounts
  isAdmin: boolean
  // Set on an account an admin created or reset: it has to pick its own password first
  mustChangePassword: boolean
}

// Only fleet owners sign themselves up; government accounts are created by an admin
export interface SignUpInput {
  fullName: string
  username: string
  password: string
  // A Sudanese mobile number, required (see phone.ts)
  phone: string
  companyName?: string
  address?: string
  tin?: string
}

// A fleet owner's own details, editable from their Profile section
export interface ProfileInput {
  fullName: string
  phone: string
  companyName: string
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
