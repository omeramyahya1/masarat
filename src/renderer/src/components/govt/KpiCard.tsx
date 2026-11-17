import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

interface KpiCardProps {
  icon: LucideIcon
  label: string
  value: string
  // Full value, shown on hover when `value` is abbreviated
  title?: string
  caption?: ReactNode
}

function KpiCard({ icon: Icon, label, value, title, caption }: KpiCardProps): React.JSX.Element {
  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2 text-sm text-stone-500">
        <span className="flex size-7 items-center justify-center rounded-md bg-brand-50 text-brand-700">
          <Icon size={16} />
        </span>
        {label}
      </div>
      <div className="text-2xl font-semibold text-stone-900 tabular-nums" title={title}>
        {value}
      </div>
      {caption && <div className="text-xs text-stone-500">{caption}</div>}
    </div>
  )
}

export default KpiCard
