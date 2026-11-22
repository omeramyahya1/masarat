import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto'
import { promisify } from 'util'
import { eq } from 'drizzle-orm'
import { getDb, users, type User } from '../db'
import {
  MAX_ADDRESS_LENGTH,
  MAX_TIN_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_PATTERN,
  type AuthErrorCode,
  type AuthResult,
  type AuthUser,
  type LogInInput,
  type ProfileInput,
  type SignUpInput,
  type UserRole
} from '@masarat/shared/auth'

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keyLength: number
) => Promise<Buffer>

const KEY_LENGTH = 64

// Stored as "scrypt$<salt hex>$<hash hex>"
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltHex, hashHex] = stored.split('$')
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false

  const expected = Buffer.from(hashHex, 'hex')
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)
  return timingSafeEqual(actual, expected)
}

function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    fullName: user.fullName,
    phone: user.phone,
    companyName: user.companyName,
    address: user.address,
    tin: user.tin
  }
}

// IPC input comes from the renderer, so treat every field as untrusted
const isRole = (value: unknown): value is UserRole => value === 'owner' || value === 'govt'
const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

// A fleet owner's carrier details: both optional, but limited in length
function checkCarrierDetails(address: string, tin: string): AuthErrorCode | null {
  if (address.length > MAX_ADDRESS_LENGTH) return 'address_too_long'
  if (tin.length > MAX_TIN_LENGTH) return 'invalid_tin'
  return null
}

// One signed-in user per panel, kept here so later IPC handlers can authorize by role
const sessions = new Map<UserRole, AuthUser>()

// Bumped when an auth request starts and on logout. A request only stores its session if no
// newer request or logout happened while it was awaiting password hashing.
const generations = new Map<UserRole, number>()

function nextGeneration(role: UserRole): number {
  const generation = (generations.get(role) ?? 0) + 1
  generations.set(role, generation)
  return generation
}

function commitSession(generation: number, user: AuthUser): AuthResult {
  if (generations.get(user.role) !== generation) return { ok: false, error: 'cancelled' }
  sessions.set(user.role, user)
  return { ok: true, user }
}

export async function signUp(input: SignUpInput): Promise<AuthResult> {
  const fullName = asText(input?.fullName)
  const username = asText(input?.username).toLowerCase()
  const password = typeof input?.password === 'string' ? input.password : ''

  if (!isRole(input?.role) || !fullName || !username || !password) {
    return { ok: false, error: 'missing_fields' }
  }
  if (!USERNAME_PATTERN.test(username)) return { ok: false, error: 'invalid_username' }
  if (password.length < PASSWORD_MIN_LENGTH) return { ok: false, error: 'weak_password' }
  const isOwner = input.role === 'owner'
  const address = isOwner ? asText(input.address) : ''
  const tin = isOwner ? asText(input.tin) : ''
  const carrierError = checkCarrierDetails(address, tin)
  if (carrierError) return { ok: false, error: carrierError }

  const generation = nextGeneration(input.role)
  const db = getDb()
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username))
    .limit(1)
  if (existing) return { ok: false, error: 'username_taken' }

  const [created] = await db
    .insert(users)
    .values({
      role: input.role,
      fullName,
      username,
      passwordHash: await hashPassword(password),
      phone: asText(input.phone) || null,
      companyName: isOwner ? asText(input.companyName) || null : null,
      address: address || null,
      tin: tin || null
    })
    .returning()

  return commitSession(generation, toAuthUser(created))
}

export async function logIn(input: LogInInput): Promise<AuthResult> {
  const username = asText(input?.username).toLowerCase()
  const password = typeof input?.password === 'string' ? input.password : ''

  if (!isRole(input?.role) || !username || !password) {
    return { ok: false, error: 'missing_fields' }
  }

  const generation = nextGeneration(input.role)
  const [found] = await getDb().select().from(users).where(eq(users.username, username)).limit(1)
  if (!found || !(await verifyPassword(password, found.passwordHash))) {
    return { ok: false, error: 'invalid_credentials' }
  }
  // The account may have been deleted while the password was checked (demo data regenerated)
  const [stillExists] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, found.id))
    .limit(1)
  if (!stillExists) return { ok: false, error: 'invalid_credentials' }
  // Only reported after the password checks out, so it doesn't reveal which usernames exist
  if (found.role !== input.role) return { ok: false, error: 'wrong_panel' }

  return commitSession(generation, toAuthUser(found))
}

// The signed-in fleet owner edits their own details; the session is updated to match
export async function updateProfile(input: ProfileInput): Promise<AuthResult> {
  const owner = sessions.get('owner')
  if (!owner) return { ok: false, error: 'not_signed_in' }
  const fullName = asText(input?.fullName)
  if (!fullName) return { ok: false, error: 'missing_fields' }
  const address = asText(input?.address)
  const tin = asText(input?.tin)
  const carrierError = checkCarrierDetails(address, tin)
  if (carrierError) return { ok: false, error: carrierError }

  const [updated] = await getDb()
    .update(users)
    .set({
      fullName,
      phone: asText(input.phone) || null,
      companyName: asText(input.companyName) || null,
      address: address || null,
      tin: tin || null
    })
    .where(eq(users.id, owner.id))
    .returning()
  if (!updated) return { ok: false, error: 'not_signed_in' }
  const user = toAuthUser(updated)
  sessions.set('owner', user)
  return { ok: true, user }
}

export function logOut(role: UserRole): void {
  nextGeneration(role)
  sessions.delete(role)
}

// Signs out any panel whose user is about to be deleted (demo accounts on "Regenerate demo data")
export function dropSessionsOf(userIds: ReadonlySet<number>): void {
  for (const [role, user] of sessions) if (userIds.has(user.id)) logOut(role)
}

export function getSession(role: UserRole): AuthUser | null {
  return sessions.get(role) ?? null
}
