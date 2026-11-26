// The portals' data cache (TanStack Query). Each list or view the API sends is a query, cached
// by its key: going back to a section or a page within a minute shows it without asking the API
// again; after that it shows the cached data at once and refreshes it in the background (and when
// the window regains focus). A change the user makes invalidates the queries it affects, so their
// lists update straight away. The cache lives in memory, so it's gone with the page; it's also
// cleared when the session ends.
import { QueryClient } from '@tanstack/react-query'
import type { TripDetails } from '@masarat/shared/billing'

// The API answered { ok: false, error }: a result to show, not a reason to retry
export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      // Once, and only when the API couldn't be reached (an ApiError is its answer)
      retry: (failures, error) => failures < 1 && !(error instanceof ApiError)
    }
  }
})

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

// The data of an API result, or an ApiError with its code
export async function unwrap<T>(call: Promise<Result<T>>): Promise<T> {
  const result = await call
  if (!result.ok) throw new ApiError(result.error)
  return result.data
}

// The error code to show for a failed query: the API's, or 'unknown' when it couldn't be reached
export function errorCode<E extends string = string>(error: unknown): E | null {
  if (!error) return null
  return (error instanceof ApiError ? error.code : 'unknown') as E
}

// Every query's key, by area. Invalidating a prefix (['trips']) refreshes everything under it.
export const queryKeys = {
  reference: ['reference'] as const,
  vehicles: ['vehicles'] as const,
  drivers: ['drivers'] as const,
  branches: ['branches'] as const,
  templates: ['templates'] as const,
  roles: ['roles'] as const,
  suggestions: ['trips', 'suggestions'] as const,
  tripList: (params: unknown) => ['trips', 'list', params] as const,
  trips: ['trips'] as const,
  trip: (side: 'company' | 'govt', id: number) => ['trip', side, id] as const,
  members: (side: 'company' | 'govt') => ['members', side] as const,
  memberRoles: (side: 'company' | 'govt') => ['members', side, 'roles'] as const,
  govtReference: ['govt', 'reference'] as const,
  companies: ['govt', 'companies'] as const,
  dashboard: (filters: unknown, view: unknown) => ['govt', 'dashboard', filters, view] as const,
  search: (params: unknown) => ['govt', 'search', params] as const,
  charges: ['govt', 'charges'] as const,
  reports: (params: unknown) => ['govt', 'reports', params] as const,
  settings: ['govt', 'settings'] as const
}

// After a trip changed (saved, billed, paid, deleted): its lists, its page, and the vehicles' and
// drivers' trip counts
export async function tripChanged(id?: number): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.trips }),
    id === undefined
      ? queryClient.invalidateQueries({ queryKey: ['trip'] })
      : queryClient.invalidateQueries({ queryKey: queryKeys.trip('company', id) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.vehicles }),
    queryClient.invalidateQueries({ queryKey: queryKeys.drivers })
  ])
}

// After a report, a dismissal, a revocation or a cancellation (the government's side): the trip's
// page takes the answer, and the reports, the search results and the dashboard (pending bills,
// trip counts) refresh. The company's own cache sees the change on its next refresh.
export async function reviewChanged(details: TripDetails): Promise<void> {
  queryClient.setQueryData(queryKeys.trip('govt', details.trip.id), details)
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['govt', 'reports'] }),
    queryClient.invalidateQueries({ queryKey: ['govt', 'search'] }),
    queryClient.invalidateQueries({ queryKey: ['govt', 'dashboard'] })
  ])
}
