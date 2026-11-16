// Types and rules shared by the main process (auth service) and the renderer (auth forms)

export type UserRole = 'owner' | 'govt'

export interface AuthUser {
  id: number
  username: string
  role: UserRole
  fullName: string
  phone: string | null
  companyName: string | null
}

export interface SignUpInput {
  role: UserRole
  fullName: string
  username: string
  password: string
  phone?: string
  companyName?: string
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
  | 'unknown'

export type AuthResult = { ok: true; user: AuthUser } | { ok: false; error: AuthErrorCode }

// Usernames are stored lowercased
export const USERNAME_PATTERN = /^[a-z0-9_.]{3,32}$/
export const PASSWORD_MIN_LENGTH = 8
