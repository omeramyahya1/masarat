import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Search, X } from 'lucide-react'
import type { ListViewState } from '../../lib/useListView'

export interface ToolbarOption {
  value: string
  label: string
}

export interface ToolbarFilter {
  key: string
  label: string
  // A select of options, or a date (YYYY-MM-DD)
  options?: readonly ToolbarOption[]
  type?: 'select' | 'date'
}

function Field({
  label,
  children
}: {
  label: string
  children: (id: string) => React.ReactNode
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-stone-500">
        {label}
      </label>
      {children(id)}
    </div>
  )
}

// Search, filters, sort (with its direction) and group-by above a list, with the count shown
function ListToolbar({
  state,
  onChange,
  onReset,
  searchPlaceholder,
  filters,
  sorts,
  groups,
  shown,
  total
}: {
  state: ListViewState
  onChange: (patch: Partial<ListViewState>) => void
  onReset: () => void
  searchPlaceholder: string
  filters: readonly ToolbarFilter[]
  sorts: readonly ToolbarOption[]
  // Omitted for lists that can't be grouped
  groups?: readonly ToolbarOption[]
  shown: number
  total: number
}): React.JSX.Element {
  const { t } = useTranslation()
  const searchId = useId()
  const active =
    state.query.trim() !== '' || Object.values(state.filters).some(Boolean) || state.group !== ''
  const setFilter = (key: string, value: string): void =>
    onChange({ filters: { ...state.filters, [key]: value } })

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1">
          <label htmlFor={searchId} className="sr-only">
            {searchPlaceholder}
          </label>
          <Search
            size={16}
            className="pointer-events-none absolute inset-y-0 start-3 my-auto text-stone-400"
          />
          <input
            id={searchId}
            type="search"
            className="input ps-9"
            placeholder={searchPlaceholder}
            value={state.query}
            onChange={(e) => onChange({ query: e.target.value })}
          />
        </div>
        <Field label={t('listView.sortBy')}>
          {(id) => (
            <div className="flex gap-1">
              <select
                id={id}
                className="input py-1.5 text-sm"
                value={state.sort}
                onChange={(e) => onChange({ sort: e.target.value })}
              >
                {sorts.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-btn border border-stone-200"
                aria-label={t(`listView.${state.direction === 'asc' ? 'ascending' : 'descending'}`)}
                title={t(`listView.${state.direction === 'asc' ? 'ascending' : 'descending'}`)}
                onClick={() => onChange({ direction: state.direction === 'asc' ? 'desc' : 'asc' })}
              >
                {state.direction === 'asc' ? (
                  <ArrowUpNarrowWide size={16} />
                ) : (
                  <ArrowDownWideNarrow size={16} />
                )}
              </button>
            </div>
          )}
        </Field>
        {groups && (
          <Field label={t('listView.groupBy')}>
            {(id) => (
              <select
                id={id}
                className="input py-1.5 text-sm"
                value={state.group}
                onChange={(e) => onChange({ group: e.target.value })}
              >
                <option value="">{t('listView.noGrouping')}</option>
                {groups.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
      </div>

      {filters.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {filters.map((filter) => (
            <Field key={filter.key} label={filter.label}>
              {(id) =>
                filter.type === 'date' ? (
                  <input
                    id={id}
                    type="date"
                    className="input py-1.5 text-sm"
                    value={state.filters[filter.key] ?? ''}
                    onChange={(e) => setFilter(filter.key, e.target.value)}
                  />
                ) : (
                  <select
                    id={id}
                    className={`input py-1.5 text-sm ${state.filters[filter.key] ? 'border-brand-300 bg-brand-50/40' : ''}`}
                    value={state.filters[filter.key] ?? ''}
                    onChange={(e) => setFilter(filter.key, e.target.value)}
                  >
                    <option value="">{t('listView.all')}</option>
                    {filter.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )
              }
            </Field>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 text-xs text-stone-500">
        <span>{t('listView.shown', { shown, total })}</span>
        {active && (
          <button type="button" className="link inline-flex items-center gap-1" onClick={onReset}>
            <X size={12} />
            {t('listView.clear')}
          </button>
        )}
      </div>
    </div>
  )
}

export default ListToolbar
