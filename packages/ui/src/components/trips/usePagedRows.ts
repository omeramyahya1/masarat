// Splits a document's table rows into printed pages. The document is first rendered once, hidden,
// on a single sheet with every row; its parts are measured and the rows dealt out so each page's
// content fits its sheet.
import { useLayoutEffect, useState, type RefObject } from 'react'

// One page: rows [start, end), whether it opens with the intro (page 1) and whether it closes with
// the tail (the total row and what follows the table: last page)
export interface PageSlice {
  start: number
  end: number
  first: boolean
  last: boolean
}

// Heights in px, as measured on the hidden sheet
export interface PageMetrics {
  // The sheet's content area
  available: number
  // The intro and the gap after it (page 1 only)
  intro: number
  // The table's heading and header row, repeated on every page that has rows
  head: number
  rows: number[]
  // The total row, then the gap and the blocks after the table
  total: number
  tail: number
}

// Fills each page with as many rows as fit. The tail stays on the last page with at least one row
// above it; if it doesn't fit, the last row moves on with it.
export function paginate(m: PageMetrics): PageSlice[] {
  const n = m.rows.length
  const fits = (height: number): boolean => height <= m.available + 0.5
  const pages: PageSlice[] = []
  let i = 0
  let first = true
  // A runaway document still stops
  while (pages.length < 100) {
    const start = i
    let used = (first ? m.intro : 0) + m.head
    while (i < n && fits(used + m.rows[i])) used += m.rows[i++]
    // A row taller than a whole page still gets a page of its own
    if (i === start && i < n && !first) used += m.rows[i++]
    if (i < n) {
      pages.push({ start, end: i, first, last: false })
    } else if (fits(used + m.total + m.tail)) {
      pages.push({ start, end: n, first, last: true })
      break
    } else {
      // Carry the last row over, so the tail never sits on a page by itself
      const end = i - start >= 2 ? n - 1 : first ? start : n
      pages.push({ start, end, first, last: false })
      i = end
      if (end === n) {
        pages.push({ start: n, end: n, first: false, last: true })
        break
      }
    }
    first = false
  }
  return pages
}

const height = (element: Element | null): number => element?.getBoundingClientRect().height ?? 0

// Measures the hidden sheet (marked with data-measure="body|intro|cargo|row|total|tail") and
// paginates; re-measures once the fonts have loaded, since Arabic text heights depend on them
export function usePagedRows(
  measureRef: RefObject<HTMLElement | null>,
  // Anything that changes the content
  key: unknown
): PageSlice[] | null {
  const [pages, setPages] = useState<PageSlice[] | null>(null)
  const [fontsReady, setFontsReady] = useState(false)

  useLayoutEffect(() => {
    let cancelled = false
    document.fonts.ready.then(() => !cancelled && setFontsReady(true))
    return (): void => {
      cancelled = true
    }
  }, [])

  useLayoutEffect(() => {
    const root = measureRef.current
    if (!root) return
    const part = (name: string): Element | null => root.querySelector(`[data-measure="${name}"]`)
    const body = part('body')
    if (!body) return
    const gap = parseFloat(getComputedStyle(body).rowGap) || 0
    const rows = [...root.querySelectorAll('[data-measure="row"]')]
    const cargo = part('cargo')
    const head =
      rows.length > 0 && cargo
        ? rows[0].getBoundingClientRect().top - cargo.getBoundingClientRect().top
        : height(cargo)
    setPages(
      paginate({
        available: body.getBoundingClientRect().height,
        intro: height(part('intro')) + gap,
        head,
        rows: rows.map(height),
        total: height(part('total')),
        tail: gap + height(part('tail'))
      })
    )
  }, [measureRef, key, fontsReady])

  return pages
}
