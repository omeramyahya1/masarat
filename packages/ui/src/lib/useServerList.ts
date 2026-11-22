// Search, filters, sort and grouping for a list the API pages (the owner's trips, the government
// search). The same settings as useListView, plus the page and page size, are kept per list for
// the session; each change asks the API for the matching page.
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { FleetErrorCode, FleetResult } from '@masarat/shared/fleet'
import { DEFAULT_PAGE_SIZE, type Page, type PageSize } from '@masarat/shared/paging'
import type { ListViewState } from './useListView'

// Typing in the search box asks the API once the user pauses
const SEARCH_DELAY_MS = 300

export interface ServerListState extends ListViewState {
  page: number
  pageSize: PageSize
}

export interface ServerListConfig {
  storageKey: string
  defaultSort: string
  defaultDirection: 'asc' | 'desc'
}

function load(key: string, fallback: ServerListState): ServerListState {
  try {
    const saved = sessionStorage.getItem(key)
    return saved ? { ...fallback, ...(JSON.parse(saved) as Partial<ServerListState>) } : fallback
  } catch {
    return fallback
  }
}

export function useServerList<T>(
  fetchPage: (state: ServerListState) => Promise<FleetResult<Page<T>>>,
  config: ServerListConfig
): {
  state: ServerListState
  // Changing the search, filters, sort or grouping goes back to the first page
  update: (patch: Partial<ListViewState>) => void
  reset: () => void
  setPage: (page: number) => void
  setPageSize: (pageSize: PageSize) => void
  // Loads the current page again (after the list changed)
  reload: () => void
  data: Page<T> | null
  error: FleetErrorCode | null
  loading: boolean
} {
  const initial: ServerListState = {
    query: '',
    filters: {},
    sort: config.defaultSort,
    direction: config.defaultDirection,
    group: '',
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE
  }
  const [state, setState] = useState<ServerListState>(() => load(config.storageKey, initial))
  const [query, setQuery] = useState(state.query)
  const [data, setData] = useState<Page<T> | null>(null)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [version, setVersion] = useState(0)
  // Only the latest request's answer is shown
  const latest = useRef(0)
  const fetchLatest = useEffectEvent(fetchPage)

  const save = (next: ServerListState): void => {
    setState(next)
    try {
      sessionStorage.setItem(config.storageKey, JSON.stringify(next))
    } catch {
      // Storage may be unavailable; the settings still apply until the list closes
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => setQuery(state.query), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [state.query])

  const { filters, sort, direction, group, page, pageSize } = state
  // The request the list shows, and the one it last got an answer for: loading while they differ
  const requested = JSON.stringify([
    query,
    filters,
    sort,
    direction,
    group,
    page,
    pageSize,
    version
  ])
  const [answered, setAnswered] = useState<string | null>(null)
  useEffect(() => {
    const request = ++latest.current
    fetchLatest({ query, filters, sort, direction, group, page, pageSize })
      .then((result) => {
        if (request !== latest.current) return
        if (result.ok) {
          setData(result.data)
          setError(null)
        } else setError(result.error)
      })
      .catch(() => request === latest.current && setError('unknown'))
      .finally(() => request === latest.current && setAnswered(requested))
  }, [query, filters, sort, direction, group, page, pageSize, version, requested])

  return {
    state,
    update: (patch) => save({ ...state, ...patch, page: 1 }),
    reset: () => save({ ...initial, pageSize: state.pageSize }),
    setPage: (next) => save({ ...state, page: next }),
    setPageSize: (next) => save({ ...state, pageSize: next, page: 1 }),
    reload: () => setVersion((v) => v + 1),
    data,
    error,
    loading: answered !== requested
  }
}
