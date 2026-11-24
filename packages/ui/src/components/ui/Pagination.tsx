import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PAGE_SIZES, pageCount, type PageSize } from '@masarat/shared/paging'
import { useFormat } from '../../lib/format'

// The pages to show as buttons: the first, the last, and two either side of the current one, with
// a gap (null) where pages are skipped
function pageNumbers(page: number, pages: number): (number | null)[] {
  const shown = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2])
  const list = [...shown].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)
  return list.flatMap((n, i) => (i > 0 && n - list[i - 1] > 1 ? [null, n] : [n]))
}

// Under a paged list: "51–100 of 1,284", previous / next, page numbers, and the page size. With
// `more`, the count stopped at `total` and more rows match ("of 1,000+").
function Pagination({
  page,
  pageSize,
  total,
  more = false,
  onPage,
  onPageSize
}: {
  page: number
  pageSize: PageSize
  total: number
  more?: boolean
  onPage: (page: number) => void
  onPageSize: (pageSize: PageSize) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const format = useFormat()
  const sizeId = useId()
  if (total === 0) return null
  const pages = pageCount(total, pageSize)
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)

  return (
    <nav
      aria-label={t('listView.pagination.label')}
      className="flex flex-wrap items-center justify-between gap-3 text-sm text-stone-600"
    >
      <span className="tabular-nums">
        {t(more ? 'listView.pagination.rangeMore' : 'listView.pagination.range', {
          from: format.number(from),
          to: format.number(to),
          total: format.number(total)
        })}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="icon-btn"
          aria-label={t('listView.pagination.previous')}
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={16} className="rtl:-scale-x-100" />
        </button>
        {pageNumbers(page, pages).map((n, i) =>
          n === null ? (
            <span key={`gap-${i}`} className="px-1 text-stone-400">
              …
            </span>
          ) : (
            <button
              key={n}
              type="button"
              aria-label={t('listView.pagination.page', { n })}
              aria-current={n === page ? 'page' : undefined}
              className={`min-w-8 rounded-md px-2 py-1 tabular-nums ${
                n === page ? 'bg-brand-700 font-semibold text-white' : 'hover:bg-stone-100'
              }`}
              onClick={() => onPage(n)}
            >
              {format.number(n)}
            </button>
          )
        )}
        <button
          type="button"
          className="icon-btn"
          aria-label={t('listView.pagination.next')}
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={16} className="rtl:-scale-x-100" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={sizeId}>{t('listView.pagination.perPage')}</label>
        <select
          id={sizeId}
          className="input w-auto py-1"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value) as PageSize)}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>
    </nav>
  )
}

export default Pagination
