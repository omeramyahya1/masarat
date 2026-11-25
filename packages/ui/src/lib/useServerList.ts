// Search, filters, sort and grouping for a list the API pages (the owner's trips, the government
// search). The same settings as useListView, plus the page and page size, are kept per list for
// the session; each change asks the API for the matching page. Pages are cached (lib/query.ts): a
// page seen within the last minute shows without a request, and while a new page loads the
// previous one stays on screen.
import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { FleetErrorCode, FleetResult } from '@masarat/shared/fleet'
import { DEFAULT_PAGE_SIZE, type Page, type PageSize } from '@masarat/shared/paging'
import type { ListViewState } from './useListView'
import { errorCode, queryClient, unwrap } from './query'

// Typing in the search box asks the API once the user pauses
const SEARCH_DELAY_MS = 300

export interface ServerListState extends ListViewState {
  page: number
  pageSize: PageSize
}

export interface ServerListConfig {
  storageKey: string
  // The cache key the pages go under (each page adds its settings); invalidating it reloads them
  queryKey: readonly unknown[]
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
  const request = { query, filters, sort, direction, group, page, pageSize }
  const result = useQuery({
    queryKey: [...config.queryKey, request],
    queryFn: () => unwrap(fetchPage(request)),
    placeholderData: keepPreviousData
  })

  return {
    state,
    update: (patch) => save({ ...state, ...patch, page: 1 }),
    reset: () => save({ ...initial, pageSize: state.pageSize }),
    setPage: (next) => save({ ...state, page: next }),
    setPageSize: (next) => save({ ...state, pageSize: next, page: 1 }),
    reload: () => void queryClient.invalidateQueries({ queryKey: config.queryKey }),
    data: result.data ?? null,
    error: errorCode<FleetErrorCode>(result.error),
    // The page shown isn't the one asked for yet (the first load, or the previous page meanwhile)
    loading: result.isPending || result.isPlaceholderData
  }
}
