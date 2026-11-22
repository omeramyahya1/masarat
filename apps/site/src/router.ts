// The site's four pages, on plain paths. The host serves index.html for every path, and the query
// string (?next=…) is kept when moving between pages.
import { useCallback, useEffect, useState } from 'react'

export type Page = 'landing' | 'login' | 'signup' | 'change-password'

const PATHS: Record<Page, string> = {
  landing: '/',
  login: '/login',
  signup: '/signup',
  'change-password': '/change-password'
}

// Unknown paths show the landing page
function pageAt(pathname: string): Page {
  const path = pathname.replace(/\/+$/, '') || '/'
  return (Object.keys(PATHS) as Page[]).find((page) => PATHS[page] === path) ?? 'landing'
}

export const hrefOf = (page: Page): string => `${PATHS[page]}${window.location.search}`

export function usePage(): [Page, (page: Page) => void] {
  const [page, setPage] = useState<Page>(() => pageAt(window.location.pathname))

  useEffect(() => {
    const onPop = (): void => setPage(pageAt(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback((next: Page) => {
    if (pageAt(window.location.pathname) !== next) window.history.pushState(null, '', hrefOf(next))
    setPage(next)
    window.scrollTo(0, 0)
  }, [])

  return [page, navigate]
}

// The portal page the user was sent here from, if any
export const nextParam = (): string | null =>
  new URLSearchParams(window.location.search).get('next')

// /verify/<token>: the page a manifest's QR code opens (handled apart from the other pages)
export function verifyTokenOf(pathname: string): string | null {
  return /^\/verify\/([^/]+)\/?$/.exec(pathname)?.[1] ?? null
}
