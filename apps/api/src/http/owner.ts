// What every fleet owner route shares: the guards, the signed-in owner's id, and the :id param
import type { AppContext } from './context'
import { requireRole, requireUser } from './middleware'

export const requireOwner = [requireUser(), requireRole('owner')] as const

// Only called behind requireOwner, so the user is there
export const ownerId = (c: AppContext): number => c.get('user')!.id

// A positive integer :id, or null (answered as "not found")
export function idParam(c: AppContext): number | null {
  const id = Number(c.req.param('id'))
  return Number.isInteger(id) && id > 0 ? id : null
}
