import { Landmark, Truck, type LucideIcon } from 'lucide-react'
import type { UserRole } from '../../shared/auth'

// Panel order in the header switcher
export const PANELS: readonly UserRole[] = ['owner', 'govt']

export const PANEL_ICONS: Record<UserRole, LucideIcon> = {
  owner: Truck,
  govt: Landmark
}
