// Login sessions. The browser keeps a random token in an HttpOnly cookie; the database keeps only
// its SHA-256, the user and the times. A session ends after IDLE_MS without a request or
// ABSOLUTE_MS after login, whichever comes first, and right away when the account is disabled.
import { createHash, randomBytes } from 'crypto'
import { and, eq, inArray, lt, ne, or } from 'drizzle-orm'
import { getDb, loginAttempts, sessions, users, type User } from '../db'

export const IDLE_MS = 2 * 60 * 60 * 1000
export const ABSOLUTE_MS = 12 * 60 * 60 * 1000
// last_seen_at is written at most this often, not on every request
const TOUCH_MS = 60 * 1000
// Login attempts are only needed for the rate limit's window
const ATTEMPTS_KEPT_MS = 24 * 60 * 60 * 1000

export const SESSION_COOKIE = 'masarat_session'

export interface ClientInfo {
  ip: string | null
  userAgent: string | null
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

// Opens a session and returns the token for the cookie
export async function createSession(
  userId: number,
  client: ClientInfo,
  now = new Date()
): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await getDb()
    .insert(sessions)
    .values({
      id: hashToken(token),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + ABSOLUTE_MS),
      ip: client.ip,
      userAgent: client.userAgent?.slice(0, 300) ?? null
    })
  return token
}

// The signed-in user for a cookie token, or null if the session is unknown, expired or its account
// disabled (an ended session is deleted)
export async function findSession(token: string, now = new Date()): Promise<User | null> {
  if (!token) return null
  const id = hashToken(token)
  const [row] = await getDb()
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1)
  if (!row) return null
  const { session, user } = row
  const idle = now.getTime() - session.lastSeenAt.getTime()
  if (now >= session.expiresAt || idle >= IDLE_MS || user.disabledAt !== null) {
    await getDb().delete(sessions).where(eq(sessions.id, id))
    return null
  }
  if (idle >= TOUCH_MS) {
    await getDb().update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id))
  }
  return user
}

export async function deleteSession(token: string): Promise<void> {
  if (token)
    await getDb()
      .delete(sessions)
      .where(eq(sessions.id, hashToken(token)))
}

// Signs a user out everywhere, except the session given (the one that changed the password)
export async function deleteUserSessions(userId: number, exceptToken?: string): Promise<void> {
  await getDb()
    .delete(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        exceptToken ? ne(sessions.id, hashToken(exceptToken)) : undefined
      )
    )
}

export async function deleteSessionsOf(userIds: readonly number[]): Promise<void> {
  if (userIds.length > 0) {
    await getDb()
      .delete(sessions)
      .where(inArray(sessions.userId, [...userIds]))
  }
}

// Removes ended sessions and old login attempts; run on startup and every hour
export async function purgeExpired(now = new Date()): Promise<void> {
  const db = getDb()
  await db
    .delete(sessions)
    .where(
      or(lt(sessions.expiresAt, now), lt(sessions.lastSeenAt, new Date(now.getTime() - IDLE_MS)))
    )
  await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.at, new Date(now.getTime() - ATTEMPTS_KEPT_MS)))
}
