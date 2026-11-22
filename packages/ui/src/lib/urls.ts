// Where the three web apps live, and where a user goes after logging in
import type { UserKind } from '@masarat/shared/permissions'

const trim = (url: string): string => url.replace(/\/+$/, '')

export const SITE_URL = trim(import.meta.env.VITE_SITE_URL ?? 'http://localhost:5175')

export const PORTAL_URLS: Record<UserKind, string> = {
  company: trim(import.meta.env.VITE_OWNER_URL ?? 'http://localhost:5173'),
  govt: trim(import.meta.env.VITE_GOVT_URL ?? 'http://localhost:5174')
}

// The page to return to after logging in: `next` only when it's on the user's own portal, so a
// crafted link can't send someone to another site (open redirect)
export function destinationFor(kind: UserKind, next: string | null): string {
  if (next) {
    try {
      const url = new URL(next)
      if (url.origin === new URL(PORTAL_URLS[kind]).origin) return url.href
    } catch {
      // Not a URL: go to the portal's home
    }
  }
  return PORTAL_URLS[kind]
}

const withNext = (path: string, next?: string): string =>
  `${SITE_URL}${path}${next ? `?next=${encodeURIComponent(next)}` : ''}`

export const loginUrl = (next?: string): string => withNext('/login', next)
export const changePasswordUrl = (next?: string): string => withNext('/change-password', next)
