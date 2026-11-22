import { useTranslation } from 'react-i18next'
import type { AuthUser } from '@masarat/shared/auth'
import LoginForm from '../components/auth/LoginForm'
import Link from '../components/Link'
import type { Page } from '../router'
import AuthCard from './AuthCard'

function LoginPage({
  demoMode,
  navigate,
  onAuthenticated
}: {
  demoMode: boolean
  navigate: (page: Page) => void
  onAuthenticated: (user: AuthUser) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <AuthCard title={t('auth.login.title')}>
      <LoginForm demoMode={demoMode} onAuthenticated={onAuthenticated} />
      <div className="mt-6 space-y-2 border-t border-stone-200 pt-4 text-center text-sm text-stone-500">
        <p>
          {t('auth.login.noAccount')}{' '}
          <Link to="signup" navigate={navigate} className="link">
            {t('auth.login.switch')}
          </Link>
        </p>
        <p className="text-xs">{t('auth.login.govtNote')}</p>
      </div>
    </AuthCard>
  )
}

export default LoginPage
