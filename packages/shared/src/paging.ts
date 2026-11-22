// Lists the API pages: the owner's trips and the government search

export const PAGE_SIZES = [25, 50, 100] as const
export type PageSize = (typeof PAGE_SIZES)[number]
export const DEFAULT_PAGE_SIZE: PageSize = 50

export interface PageQuery {
  // 1-based
  page: number
  pageSize: PageSize
}

// A group of a grouped list: its key, and its size and total over every page, not just this one
export interface GroupSummary {
  key: string
  count: number
  totalDue: number
}

// In a grouped list each row carries the key of the group it belongs to
export type Grouped<T> = T & { groupKey?: string }

export interface Page<T> {
  rows: Grouped<T>[]
  // Rows matching the search and filters, on every page
  total: number
  // Every row, before the search and filters (tells "no trips yet" from "no matches")
  overall: number
  page: number
  pageSize: PageSize
  // The groups the rows on this page belong to, in order (grouped lists only)
  groups?: GroupSummary[]
}

export const isPageSize = (value: unknown): value is PageSize =>
  (PAGE_SIZES as readonly unknown[]).includes(value)

export const pageCount = (total: number, pageSize: number): number =>
  Math.max(1, Math.ceil(total / pageSize))
