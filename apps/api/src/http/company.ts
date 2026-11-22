// What every company route shares: the guards and the signed-in member's company scope
import type { AppContext } from './context'
import { requireKind, requireUser } from './middleware'
import { scopeOf, type CompanyScope } from '../services/access'

export const requireCompany = [requireUser(), requireKind('company')] as const

// Only called behind requireCompany, so the user and their company are there
export const companyScope = (c: AppContext): CompanyScope => scopeOf(c.get('user')!)
export const companyId = (c: AppContext): number => c.get('user')!.company!.id
export const userId = (c: AppContext): number => c.get('user')!.id
