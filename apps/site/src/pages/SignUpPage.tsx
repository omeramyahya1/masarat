import { useTranslation } from 'react-i18next'
import type { AuthUser } from '@masarat/shared/auth'
import SignUpForm from '../components/auth/SignUpForm'
import Link from '../components/Link'
import type { Page } from '../router'
import AuthCard from './AuthCard'

function SignUpPage({
  navigate,
  onAuthenticated
}: {
  navigate: (page: Page) => void
  onAuthenticated: (user: AuthUser) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <AuthCard title={t('auth.signup.title')} subtitle={t('auth.signup.subtitle')} wide>
      <SignUpForm onAuthenticated={onAuthenticated} />
      <p className="mt-6 border-t border-stone-200 pt-4 text-center text-sm text-stone-500">
        {t('auth.signup.haveAccount')}{' '}
        <Link to="login" navigate={navigate} className="link">
          {t('auth.signup.switch')}
        </Link>
      </p>
    </AuthCard>
  )
}

export default SignUpPage
