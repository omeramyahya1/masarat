import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuthUser, UserRole } from '@masarat/shared/auth'
import { PANEL_ICONS } from '../../panels'
import LoginForm from './LoginForm'
import SignUpForm from './SignUpForm'

interface AuthPanelProps {
  role: UserRole
  onAuthenticated: (user: AuthUser) => void
}

function AuthPanel({ role, onAuthenticated }: AuthPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const Icon = PANEL_ICONS[role]

  return (
    <div className="flex flex-1 items-start justify-center overflow-auto px-6 py-10">
      <div className="card w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3 border-b border-stone-200 pb-6">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <Icon size={22} strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-stone-900">{t(`panels.${role}.title`)}</h1>
            <p className="text-sm text-stone-500">{t(`panels.${role}.subtitle`)}</p>
          </div>
        </div>

        <h2 className="mb-4 text-base font-semibold text-stone-800">
          {mode === 'login' ? t('auth.login.title') : t('auth.signup.title')}
        </h2>

        {mode === 'login' ? (
          <LoginForm role={role} onAuthenticated={onAuthenticated} />
        ) : (
          <SignUpForm role={role} onAuthenticated={onAuthenticated} />
        )}

        <p className="mt-6 text-center text-sm text-stone-500">
          {mode === 'login' ? t('auth.login.noAccount') : t('auth.signup.haveAccount')}{' '}
          <button
            type="button"
            className="link"
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
          >
            {mode === 'login' ? t('auth.login.switch') : t('auth.signup.switch')}
          </button>
        </p>
      </div>
    </div>
  )
}

export default AuthPanel
