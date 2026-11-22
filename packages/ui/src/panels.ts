import { Landmark, Truck, type LucideIcon } from 'lucide-react'
import type { UserKind } from '@masarat/shared/permissions'

// Each portal's icon (the landing page's cards)
export const PANEL_ICONS: Record<UserKind, LucideIcon> = {
  company: Truck,
  govt: Landmark
}
