import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Route } from 'lucide-react'
import type { AuthUser, UserRole } from '../../shared/auth'
import { PANELS, PANEL_ICONS } from './panels'
import AuthPanel from './components/auth/AuthPanel'
import HomeView from './components/HomeView'
import UpdateNotification from './components/UpdateNotification'

// Each panel has its own signed-in user
type Sessions = Record<UserRole, AuthUser | null>

function App(): React.JSX.Element {
  const { t } = useTranslation()
  const [activeRole, setActiveRole] = useState<UserRole>('govt')
  const [sessions, setSessions] = useState<Sessions>({ owner: null, govt: null })

  // Restore sessions kept by the main process (e.g. after a renderer reload)
  useEffect(() => {
    Promise.all([window.api.auth.getSession('owner'), window.api.auth.getSession('govt')]).then(
      ([owner, govt]) => setSessions({ owner, govt })
    )
  }, [])

  const setSession = (role: UserRole, user: AuthUser | null): void =>
    setSessions((current) => ({ ...current, [role]: user }))

  const handleLogOut = async (role: UserRole): Promise<void> => {
    await window.api.auth.logOut(role)
    setSession(role, null)
  }

  const user = sessions[activeRole]

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
              <span className="rounded border border-brand-200 bg-brand-50 px-1.5 text-[10px] font-semibold tracking-wide text-brand-700 uppercase">
                {t('app.badge')}
              </span>
            </div>
            <div className="text-xs text-stone-500">{t('app.tagline')}</div>
          </div>
        </div>

        <div
          className="flex gap-1 rounded-lg border border-stone-200 bg-stone-100 p-1"
          role="tablist"
          aria-label={t('app.panelSwitcher')}
        >
          {PANELS.map((role) => {
            const Icon = PANEL_ICONS[role]
            const active = role === activeRole
            return (
              <button
                key={role}
                type="button"
                role="tab"
                aria-selected={active}
                className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-white text-brand-800 shadow-sm ring-1 ring-stone-200'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
                onClick={() => setActiveRole(role)}
              >
                <Icon size={16} />
                {t(`panels.${role}.tab`)}
              </button>
            )
          })}
        </div>
      </header>

      <main className="flex flex-1 flex-col overflow-auto">
        {user ? (
          <HomeView key={activeRole} user={user} onLogOut={() => handleLogOut(activeRole)} />
        ) : (
          <AuthPanel
            key={activeRole}
            role={activeRole}
            onAuthenticated={(authUser) => setSession(activeRole, authUser)}
          />
        )}
      </main>

      <UpdateNotification />
    </>
  )
}

export default App
