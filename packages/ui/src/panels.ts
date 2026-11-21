import { Landmark, Truck, type LucideIcon } from 'lucide-react'
import type { UserRole } from '@masarat/shared/auth'

// Each portal's icon, on its login page
export const PANEL_ICONS: Record<UserRole, LucideIcon> = {
  owner: Truck,
  govt: Landmark
}
