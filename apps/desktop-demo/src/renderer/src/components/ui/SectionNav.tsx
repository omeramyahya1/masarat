import type { LucideIcon } from 'lucide-react'

// Tabs across the top of a workspace (fleet owner or government)
function SectionNav<T extends string>({
  label,
  sections,
  value,
  onChange
}: {
  label: string
  sections: readonly { id: T; label: string; icon: LucideIcon }[]
  value: T
  onChange: (id: T) => void
}): React.JSX.Element {
  return (
    <nav className="flex gap-6 border-b border-stone-200 bg-white px-6" aria-label={label}>
      {sections.map(({ id, label: sectionLabel, icon: Icon }) => {
        const active = id === value
        return (
          <button
            key={id}
            type="button"
            aria-current={active ? 'page' : undefined}
            className={`-mb-px flex items-center gap-2 border-b-2 py-3 text-sm font-medium transition-colors ${
              active
                ? 'border-brand-700 text-brand-800'
                : 'border-transparent text-stone-500 hover:text-stone-800'
            }`}
            onClick={() => onChange(id)}
          >
            <Icon size={16} />
            {sectionLabel}
          </button>
        )
      })}
    </nav>
  )
}

export default SectionNav
