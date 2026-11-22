// Government accounts, managed by government admins (Government portal → Users)
export interface GovtUserRecord {
  id: number
  username: string
  fullName: string
  phone: string | null
  isAdmin: boolean
  // Disabled accounts can't log in; their history stays
  disabled: boolean
  mustChangePassword: boolean
  createdAt: number
}

export interface NewGovtUserInput {
  username: string
  fullName: string
  phone?: string
  isAdmin?: boolean
}

// What an admin gets back when creating an account or resetting its password: the temporary
// password, shown once, that the user replaces at their first login
export interface IssuedPassword {
  user: GovtUserRecord
  temporaryPassword: string
}

export type GovtUserErrorCode =
  | 'missing_fields'
  | 'invalid_username'
  | 'username_taken'
  | 'user_not_found'
  // The action would leave no active admin
  | 'last_admin'
  // Admins can't disable, demote or reset themselves here
  | 'cannot_change_self'
  | 'not_signed_in'
  | 'forbidden'
  | 'password_change_required'
  | 'unknown'

export type GovtUserResult<T> = { ok: true; data: T } | { ok: false; error: GovtUserErrorCode }
