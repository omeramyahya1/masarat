// Search, filters, sort and grouping for a list loaded in full (the owner's trips, vehicles and
// drivers). The settings are kept per list for the session, so they survive switching sections.
import { useMemo, useState } from 'react'

export interface ListViewState {
  query: string
  // Filter values by filter key; '' means not filtered
  filters: Record<string, string>
  sort: string
  direction: 'asc' | 'desc'
  // '' means not grouped
  group: string
}

export interface ListGroup<T> {
  key: string
  label: string
  items: T[]
}

export interface ListViewConfig<T> {
  // Session storage key for the list's settings
  storageKey: string
  defaultSort: string
  defaultDirection: 'asc' | 'desc'
  matches: (item: T, query: string) => boolean
  filters: Record<string, (item: T, value: string) => boolean>
  // Ascending comparisons; the direction flips them
  sorts: Record<string, (a: T, b: T) => number>
  // Each item's group, and the order the groups are listed in
  groups?: Record<string, (item: T) => { key: string; label: string; order: string | number }>
}

function load(key: string, fallback: ListViewState): ListViewState {
  try {
    const saved = sessionStorage.getItem(key)
    return saved ? { ...fallback, ...(JSON.parse(saved) as Partial<ListViewState>) } : fallback
  } catch {
    return fallback
  }
}

export function useListView<T>(
  items: readonly T[] | null,
  config: ListViewConfig<T>
): {
  state: ListViewState
  update: (patch: Partial<ListViewState>) => void
  reset: () => void
  visible: T[]
  groups: ListGroup<T>[] | null
  total: number
} {
  const initial: ListViewState = {
    query: '',
    filters: {},
    sort: config.defaultSort,
    direction: config.defaultDirection,
    group: ''
  }
  const [state, setState] = useState<ListViewState>(() => load(config.storageKey, initial))

  const save = (next: ListViewState): void => {
    setState(next)
    try {
      sessionStorage.setItem(config.storageKey, JSON.stringify(next))
    } catch {
      // Storage may be unavailable; the settings still apply until the panel closes
    }
  }

  const { matches, filters, sorts, groups: groupers } = config
  const visible = useMemo(() => {
    const query = state.query.trim().toLowerCase()
    const filtered = (items ?? []).filter(
      (item) =>
        (!query || matches(item, query)) &&
        Object.entries(state.filters).every(
          ([key, value]) => !value || !filters[key] || filters[key](item, value)
        )
    )
    const compare = sorts[state.sort]
    if (compare) {
      const sign = state.direction === 'asc' ? 1 : -1
      filtered.sort((a, b) => sign * compare(a, b))
    }
    return filtered
  }, [items, state, matches, filters, sorts])

  const groups = useMemo(() => {
    const grouper = state.group ? groupers?.[state.group] : undefined
    if (!grouper) return null
    const byKey = new Map<string, ListGroup<T> & { order: string | number }>()
    for (const item of visible) {
      const { key, label, order } = grouper(item)
      const group = byKey.get(key) ?? { key, label, order, items: [] }
      group.items.push(item)
      byKey.set(key, group)
    }
    return [...byKey.values()].sort((a, b) =>
      typeof a.order === 'number' && typeof b.order === 'number'
        ? a.order - b.order
        : String(a.order).localeCompare(String(b.order))
    )
  }, [visible, state.group, groupers])

  return {
    state,
    update: (patch) => save({ ...state, ...patch }),
    reset: () => save(initial),
    visible,
    groups,
    total: items?.length ?? 0
  }
}
