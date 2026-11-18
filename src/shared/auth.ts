// Types and rules shared by the main process (auth service) and the renderer (auth forms)

export type UserRole = 'owner' | 'govt'

export interface AuthUser {
  id: number
  username: string
  role: UserRole
  fullName: string
  phone: string | null
  companyName: string | null
  // Fleet owners' carrier details, printed on their manifests
  address: string | null
  tin: string | null
}

export interface SignUpInput {
  role: UserRole
  fullName: string
  username: string
  password: string
  phone?: string
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
  role: UserRole
  username: string
  password: string
}

export type AuthErrorCode =
  | 'missing_fields'
  | 'invalid_username'
  | 'weak_password'
  | 'username_taken'
  | 'invalid_credentials'
  | 'wrong_panel'
  | 'cancelled'
  | 'invalid_tin'
  | 'address_too_long'
  | 'not_signed_in'
  | 'unknown'

export type AuthResult = { ok: true; user: AuthUser } | { ok: false; error: AuthErrorCode }

// Usernames are stored lowercased
export const USERNAME_PATTERN = /^[a-z0-9_.]{3,32}$/
export const PASSWORD_MIN_LENGTH = 8
// Tax Identification Number (الرقم الضريبي): free text, at most this long
export const MAX_TIN_LENGTH = 30
export const MAX_ADDRESS_LENGTH = 200
