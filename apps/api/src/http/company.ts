// What every fleet owner route shares: the guards and the signed-in owner's id
import type { AppContext } from './context'
import { requireRole, requireUser } from './middleware'

export const requireOwner = [requireUser(), requireRole('owner')] as const

// Only called behind requireOwner, so the user is there
export const ownerId = (c: AppContext): number => c.get('user')!.id
