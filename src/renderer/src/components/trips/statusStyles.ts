import type { ManifestStatus } from '../../../../shared/fleet'

export const STATUS_STYLES: Record<ManifestStatus, string> = {
  draft: 'bg-stone-100 text-stone-700 ring-stone-200',
  billed: 'bg-amber-50 text-amber-800 ring-amber-200',
  paid: 'bg-sky-50 text-sky-800 ring-sky-200',
  certified: 'bg-brand-50 text-brand-800 ring-brand-200',
  cancelled: 'bg-red-50 text-red-800 ring-red-200'
}
