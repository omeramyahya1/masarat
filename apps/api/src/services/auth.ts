// Accounts: logging in (with a rate limit), fleet owner sign-up, the owner's profile and changing
// a password. Sessions themselves live in services/sessions.ts.
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto'
import { promisify } from 'util'
import { and, count, eq, gte, ne } from 'drizzle-orm'
import { getDb, isUniqueViolation, loginAttempts, users, type User } from '../db'
import {
  MAX_ADDRESS_LENGTH,
  MAX_TIN_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_PATTERN,
  type AuthErrorCode,
  type AuthResult,
  type AuthUser,
  type ChangePasswordInput,
  type LogInInput,
  type ProfileInput,
  type SignUpInput
} from '@masarat/shared/auth'
import { normalizeSudanPhone } from '@masarat/shared/phone'
import { createSession, deleteUserSessions, type ClientInfo } from './sessions'

// Argon2id with Bun's defaults (OWASP's first choice for password storage)
export const hashPassword = (password: string): Promise<string> =>
  Bun.password.hash(password, { algorithm: 'argon2id' })

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keyLength: number
) => Promise<Buffer>

// Hashes from before Argon2id ("scrypt$<salt hex>$<hash hex>"); rehashed on the next login
async function verifyScrypt(password: string, stored: string): Promise<boolean> {
  const [, saltHex, hashHex] = stored.split('$')
  if (!saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(actual, expected)
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('scrypt$')) return verifyScrypt(password, stored)
  try {
    return await Bun.password.verify(password, stored)
  } catch {
    return false
  }
}

// Checked against when the username doesn't exist, so the answer takes as long either way
const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'))

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    fullName: user.fullName,
    phone: user.phone,
    companyName: user.companyName,
    address: user.address,
    tin: user.tin,
    isAdmin: user.isAdmin,
    mustChangePassword: user.mustChangePassword
  }
}

// Input comes from the browser, so treat every field as untrusted
const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const asPassword = (value: unknown): string => (typeof value === 'string' ? value : '')

// A fleet owner's carrier details: both optional, but limited in length
function checkCarrierDetails(address: string, tin: string): AuthErrorCode | null {
  if (address.length > MAX_ADDRESS_LENGTH) return 'address_too_long'
  if (tin.length > MAX_TIN_LENGTH) return 'invalid_tin'
  return null
}

// Every account has its own Sudanese mobile number: null when the input isn't one
export const accountPhone = (value: unknown): string | null =>
  normalizeSudanPhone(typeof value === 'string' ? value : '')

// Whether another account already has this number (the unique index still decides on a race)
export async function phoneTaken(phone: string, exceptUserId?: number): Promise<boolean> {
  const condition = and(
    eq(users.phone, phone),
    exceptUserId === undefined ? undefined : ne(users.id, exceptUserId)
  )
  const [taken] = await getDb().select({ id: users.id }).from(users).where(condition).limit(1)
  return Boolean(taken)
}

export const isPhoneConflict = (error: unknown): boolean =>
  isUniqueViolation(error, 'users_phone_unique')

// A signed-in user and the token for their session cookie
export type LoginResult =
  { ok: true; user: AuthUser; token: string } | { ok: false; error: AuthErrorCode }

// Password guessing: after this many failures in the window, logins for that username (or from
// that IP) are refused until the window has passed
export const RATE_WINDOW_MS = 15 * 60 * 1000
export const MAX_FAILURES_PER_USERNAME = 5
export const MAX_FAILURES_PER_IP = 20

async function failuresSince(
  column: typeof loginAttempts.username | typeof loginAttempts.ip,
  value: string,
  since: Date
): Promise<number> {
  const [row] = await getDb()
    .select({ value: count() })
    .from(loginAttempts)
    .where(and(eq(column, value), eq(loginAttempts.succeeded, false), gte(loginAttempts.at, since)))
  return row?.value ?? 0
}

async function isRateLimited(username: string, ip: string | null, now: Date): Promise<boolean> {
  const since = new Date(now.getTime() - RATE_WINDOW_MS)
  if ((await failuresSince(loginAttempts.username, username, since)) >= MAX_FAILURES_PER_USERNAME) {
    return true
  }
  return ip !== null && (await failuresSince(loginAttempts.ip, ip, since)) >= MAX_FAILURES_PER_IP
}

export async function logIn(
  input: LogInInput,
  client: ClientInfo,
  now = new Date()
): Promise<LoginResult> {
  const username = asText(input?.username).toLowerCase()
  const password = asPassword(input?.password)
  if (!username || !password) return { ok: false, error: 'missing_fields' }
  if (await isRateLimited(username, client.ip, now))
    return { ok: false, error: 'too_many_attempts' }

  const db = getDb()
  const [found] = await db.select().from(users).where(eq(users.username, username)).limit(1)
  const valid = await verifyPassword(password, found?.passwordHash ?? DUMMY_HASH)
  await db.insert(loginAttempts).values({ username, ip: client.ip, succeeded: valid, at: now })
  if (!found || !valid) return { ok: false, error: 'invalid_credentials' }
  // Only reported after the password checks out, so it doesn't reveal which usernames exist
  if (found.disabledAt !== null) return { ok: false, error: 'account_disabled' }

  if (found.passwordHash.startsWith('scrypt$')) {
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password) })
      .where(eq(users.id, found.id))
  }
  const token = await createSession(found.id, client, now)
  return { ok: true, user: toAuthUser(found), token }
}

// Fleet owners only; government accounts are created by a government admin
export async function signUp(input: SignUpInput, client: ClientInfo): Promise<LoginResult> {
  const fullName = asText(input?.fullName)
  const username = asText(input?.username).toLowerCase()
  const password = asPassword(input?.password)

  if (!fullName || !username || !password || !asText(input?.phone)) {
    return { ok: false, error: 'missing_fields' }
  }
  if (!USERNAME_PATTERN.test(username)) return { ok: false, error: 'invalid_username' }
  if (password.length < PASSWORD_MIN_LENGTH) return { ok: false, error: 'weak_password' }
  const phone = accountPhone(input.phone)
  if (!phone) return { ok: false, error: 'invalid_phone' }
  const address = asText(input.address)
  const tin = asText(input.tin)
  const carrierError = checkCarrierDetails(address, tin)
  if (carrierError) return { ok: false, error: carrierError }
  if (await phoneTaken(phone)) return { ok: false, error: 'phone_taken' }

  let created: User | undefined
  try {
    ;[created] = await getDb()
      .insert(users)
      .values({
        role: 'owner',
        fullName,
        username,
        passwordHash: await hashPassword(password),
        phone,
        companyName: asText(input.companyName) || null,
        address: address || null,
        tin: tin || null
      })
      // The unique index decides, so two sign-ups with one username can't both succeed
      .onConflictDoNothing({ target: users.username })
      .returning()
  } catch (error) {
    if (isPhoneConflict(error)) return { ok: false, error: 'phone_taken' }
    throw error
  }
  if (!created) return { ok: false, error: 'username_taken' }
  const token = await createSession(created.id, client)
  return { ok: true, user: toAuthUser(created), token }
}

// The signed-in fleet owner edits their own details
export async function updateProfile(ownerId: number, input: ProfileInput): Promise<AuthResult> {
  const fullName = asText(input?.fullName)
  if (!fullName || !asText(input?.phone)) return { ok: false, error: 'missing_fields' }
  const phone = accountPhone(input.phone)
  if (!phone) return { ok: false, error: 'invalid_phone' }
  const address = asText(input?.address)
  const tin = asText(input?.tin)
  const carrierError = checkCarrierDetails(address, tin)
  if (carrierError) return { ok: false, error: carrierError }
  if (await phoneTaken(phone, ownerId)) return { ok: false, error: 'phone_taken' }

  let updated: User | undefined
  try {
    ;[updated] = await getDb()
      .update(users)
      .set({
        fullName,
        phone,
        companyName: asText(input.companyName) || null,
        address: address || null,
        tin: tin || null
      })
      .where(and(eq(users.id, ownerId), eq(users.role, 'owner')))
      .returning()
  } catch (error) {
    if (isPhoneConflict(error)) return { ok: false, error: 'phone_taken' }
    throw error
  }
  if (!updated) return { ok: false, error: 'not_signed_in' }
  return { ok: true, user: toAuthUser(updated) }
}

// Replaces the user's password (also a temporary one) and signs out their other sessions
export async function changePassword(
  userId: number,
  input: ChangePasswordInput,
  currentToken: string
): Promise<AuthResult> {
  const currentPassword = asPassword(input?.currentPassword)
  const newPassword = asPassword(input?.newPassword)
  if (!currentPassword || !newPassword) return { ok: false, error: 'missing_fields' }
  if (newPassword.length < PASSWORD_MIN_LENGTH) return { ok: false, error: 'weak_password' }
  if (newPassword === currentPassword) return { ok: false, error: 'same_password' }

  const db = getDb()
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  if (!user) return { ok: false, error: 'not_signed_in' }
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    return { ok: false, error: 'wrong_password' }
  }
  const [updated] = await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword), mustChangePassword: false })
    .where(eq(users.id, userId))
    .returning()
  await deleteUserSessions(userId, currentToken)
  return { ok: true, user: toAuthUser(updated) }
}
