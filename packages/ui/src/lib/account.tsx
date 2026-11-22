// The signed-in account, for any component under AppShell: who they are, and what their role lets
// them do. The portals show only what the user can use; the API checks every request itself.
import { createContext, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuthUser } from '@masarat/shared/auth'
import type { Permission, RoleSummary } from '@masarat/shared/permissions'

export const AccountContext = createContext<AuthUser | null>(null)

export function useAccount(): AuthUser {
  const account = useContext(AccountContext)
  if (!account) throw new Error('useAccount needs AppShell')
  return account
}

// Whether the user's role grants any of these permissions
export function useCan(): (...permissions: Permission[]) => boolean {
  const { permissions } = useAccount()
  return (...wanted) => wanted.some((p) => permissions.includes(p))
}

// A role's name: the built-in ones translated, a company's own as it named it
export function useRoleName(): (role: RoleSummary) => string {
  const { t } = useTranslation()
  return (role) => (role.key ? t(`roles.${role.key}`) : role.name)
}
