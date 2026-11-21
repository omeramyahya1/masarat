import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LogOut, Route, UserRound } from 'lucide-react'
import type { AuthUser, UserRole } from '@masarat/shared/auth'
import { api } from '@masarat/api-client'
import AuthPanel from './auth/AuthPanel'
import LanguageToggle from './LanguageToggle'

interface AppShellProps {
  // The portal's role: owner.masarat.com or govt.masarat.com
  role: UserRole
  version: string
  children: (user: AuthUser, onUserChange: (user: AuthUser) => void) => React.ReactNode
}

// The header, the login page and the signed-in user bar, shared by both portals
function AppShell({ role, version, children }: AppShellProps): React.JSX.Element {
  const { t } = useTranslation()
  const [user, setUser] = useState<AuthUser | null>(null)

  // Restore the session after a reload
  useEffect(() => {
    api.auth
      .getSession(role)
      .then(setUser)
      .catch(() => setUser(null))
  }, [role])

  const handleLogOut = async (): Promise<void> => {
    await api.auth.logOut(role)
    setUser(null)
  }

  return (
    <>
      <header className="z-10 flex h-16 shrink-0 items-center justify-between border-b border-stone-200 bg-white px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg bg-brand-700 text-white">
            <Route size={20} strokeWidth={2} />
          </div>
          <div className="leading-tight">
            <div className="flex items-center gap-2 text-base font-semibold text-stone-900">
              {t('app.name')}
              <span
                dir="ltr"
                className="rounded border border-stone-200 bg-stone-100 px-1.5 text-[10px] font-semibold text-stone-600 tabular-nums"
              >
                {t('app.version', { version })}
              </span>
            </div>
            <div className="text-xs text-stone-500">{t(`panels.${role}.title`)}</div>
          </div>
        </div>
        <LanguageToggle />
      </header>

      <main className="flex flex-1 flex-col overflow-auto">
        {user ? (
          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-stone-200 bg-white px-6 py-3">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <UserRound size={18} />
                </div>
                <div className="leading-tight">
                  <div className="font-medium text-stone-900">{user.fullName}</div>
                  <div className="text-xs text-stone-500">{user.username}</div>
                </div>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleLogOut}>
                <LogOut size={16} className="rtl:-scale-x-100" />
                {t('home.logOut')}
              </button>
            </div>
            {children(user, setUser)}
          </div>
        ) : (
          <AuthPanel role={role} onAuthenticated={setUser} />
        )}
      </main>
    </>
  )
}

export default AppShell
