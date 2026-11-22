import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, LogOut, Route, UserRound, WifiOff } from 'lucide-react'
import type { AuthUser } from '@masarat/shared/auth'
import type { UserKind } from '@masarat/shared/permissions'
import { api, SIGNED_OUT_EVENT } from '@masarat/api-client'
import { PORTAL_URLS, SITE_URL, changePasswordUrl, loginUrl } from '../lib/urls'
import { AccountContext, useRoleName } from '../lib/account'
import LanguageToggle from './LanguageToggle'

interface AppShellProps {
  // Whose portal: owner.masarat.com (companies) or govt.masarat.com
  kind: UserKind
  version: string
  children: (user: AuthUser, onUserChange: (user: AuthUser) => void) => React.ReactNode
}

type State = { status: 'loading' } | { status: 'offline' } | { status: 'ready'; user: AuthUser }

// The header and the signed-in user bar, shared by both portals. Logging in happens on
// masarat.com: a visitor without a session is sent there and comes back once signed in, and a
// user of the other portal is sent to theirs.
function AppShell({ kind, version, children }: AppShellProps): React.JSX.Element {
  const { t } = useTranslation()
  const roleName = useRoleName()
  const [state, setState] = useState<State>({ status: 'loading' })

  // Bumped by "Try again" when the API couldn't be reached
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    api.auth
      .getSession()
      .then((user) => {
        const here = window.location.href
        if (!user) window.location.assign(loginUrl(here))
        else if (user.mustChangePassword) window.location.assign(changePasswordUrl(here))
        else if (user.kind !== kind) window.location.assign(PORTAL_URLS[user.kind])
        else setState({ status: 'ready', user })
      })
      .catch(() => setState({ status: 'offline' }))
  }, [kind, attempt])

  const retry = (): void => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }

  // Any API call that finds the session ended (expired, signed out elsewhere, account disabled)
  useEffect(() => {
    const onSignedOut = (): void => window.location.assign(loginUrl(window.location.href))
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut)
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut)
  }, [])

  const handleLogOut = async (): Promise<void> => {
    try {
      await api.auth.logOut()
    } finally {
      window.location.assign(SITE_URL)
    }
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
            <div className="text-xs text-stone-500">{t(`panels.${kind}.title`)}</div>
          </div>
        </div>
        <LanguageToggle />
      </header>

      <main className="flex flex-1 flex-col overflow-auto">
        {state.status === 'ready' ? (
          <div className="flex flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-stone-200 bg-white px-6 py-3">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                  <UserRound size={18} />
                </div>
                <div className="leading-tight">
                  <div className="font-medium text-stone-900">{state.user.fullName}</div>
                  <div className="text-xs text-stone-500">
                    <bdi>{state.user.username}</bdi> · {roleName(state.user.role)}
                    {state.user.branch && (
                      <>
                        {' · '}
                        <bdi>{state.user.branch.name}</bdi>
                      </>
                    )}
                    {state.user.company && (
                      <>
                        {' · '}
                        <bdi>{state.user.company.name}</bdi>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleLogOut}>
                <LogOut size={16} className="rtl:-scale-x-100" />
                {t('home.logOut')}
              </button>
            </div>
            <AccountContext.Provider value={state.user}>
              {children(state.user, (user) => setState({ status: 'ready', user }))}
            </AccountContext.Provider>
          </div>
        ) : state.status === 'offline' ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <WifiOff size={28} className="text-stone-400" />
            <p className="text-sm text-stone-600">{t('shell.offline')}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={retry}>
              {t('shell.retry')}
            </button>
          </div>
        ) : (
          <div
            className="flex flex-1 items-center justify-center"
            role="status"
            aria-label={t('shell.loading')}
          >
            <LoaderCircle size={28} className="animate-spin text-brand-700" />
          </div>
        )}
      </main>
    </>
  )
}

export default AppShell
