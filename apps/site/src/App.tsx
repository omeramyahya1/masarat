import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle } from 'lucide-react'
import type { AuthUser } from '@masarat/shared/auth'
import { destinationFor } from '@masarat/ui/lib/urls'
import { api } from '@masarat/api-client'
import { nextParam, usePage } from './router'
import SiteHeader from './components/SiteHeader'
import SiteFooter from './components/SiteFooter'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import SignUpPage from './pages/SignUpPage'
import ChangePasswordPage from './pages/ChangePasswordPage'

// The session as far as the site knows: still asking, nobody, or a user who must pick a password
type Session =
  { status: 'checking' } | { status: 'none' } | { status: 'mustChange'; user: AuthUser }

// Sends a signed-in user to their portal: back to the page they came from, or the portal's home
const goToPortal = (user: AuthUser): void =>
  window.location.replace(destinationFor(user.role, nextParam()))

// masarat.com: the landing page, login and fleet owner sign-up. Whoever is signed in is sent on
// to their portal, except an account that still has to replace its temporary password.
function App(): React.JSX.Element {
  const { t } = useTranslation()
  const [page, navigate] = usePage()
  const [session, setSession] = useState<Session>({ status: 'checking' })
  const [demoMode, setDemoMode] = useState(false)

  useEffect(() => {
    api.config
      .get()
      .then((result) => setDemoMode(result.data.demoMode))
      .catch(() => undefined)
    api.auth
      .getSession()
      .then((user) => {
        if (!user) return setSession({ status: 'none' })
        if (!user.mustChangePassword) return goToPortal(user)
        setSession({ status: 'mustChange', user })
      })
      // The API can't be reached: show the pages, and the forms report the error
      .catch(() => setSession({ status: 'none' }))
  }, [])

  // The change-password page needs a signed-in user, and such a user can't go anywhere else
  useEffect(() => {
    if (session.status === 'mustChange' && page !== 'change-password') navigate('change-password')
    if (session.status === 'none' && page === 'change-password') navigate('login')
  }, [session, page, navigate])

  const onAuthenticated = (user: AuthUser): void => {
    if (user.mustChangePassword) setSession({ status: 'mustChange', user })
    else goToPortal(user)
  }

  const logOut = async (): Promise<void> => {
    try {
      await api.auth.logOut()
    } finally {
      setSession({ status: 'none' })
      navigate('login')
    }
  }

  const content =
    session.status === 'checking' ? (
      <div
        className="flex flex-1 items-center justify-center"
        role="status"
        aria-label={t('shell.loading')}
      >
        <LoaderCircle size={28} className="animate-spin text-brand-700" />
      </div>
    ) : session.status === 'mustChange' ? (
      <ChangePasswordPage user={session.user} onChanged={onAuthenticated} onLogOut={logOut} />
    ) : page === 'login' ? (
      <LoginPage demoMode={demoMode} navigate={navigate} onAuthenticated={onAuthenticated} />
    ) : page === 'signup' ? (
      <SignUpPage navigate={navigate} onAuthenticated={onAuthenticated} />
    ) : (
      <LandingPage navigate={navigate} />
    )

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <SiteHeader page={page} navigate={navigate} />
      <main className="flex flex-1 flex-col">{content}</main>
      <SiteFooter />
    </div>
  )
}

export default App
