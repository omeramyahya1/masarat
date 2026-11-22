import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound } from 'lucide-react'
import type { AuthUser } from '@masarat/shared/auth'
import { DEMO_ACCOUNTS } from '@masarat/shared/demo'
import Menu from '@masarat/ui/components/ui/Menu'
import {
  FormError,
  PasswordField,
  SubmitButton,
  TextField
} from '@masarat/ui/components/auth/fields'
import { useAuthSubmit } from '@masarat/ui/components/auth/useAuthSubmit'
import { api } from '@masarat/api-client'

interface LoginFormProps {
  // Lists the demo accounts (the API runs in demo mode)
  demoMode: boolean
  onAuthenticated: (user: AuthUser) => void
}

// One form for every account: the account's role decides which portal the user goes to
function LoginForm({ demoMode, onAuthenticated }: LoginFormProps): React.JSX.Element {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const { error, pending, setError, submit } = useAuthSubmit(onAuthenticated)

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!username.trim() || !password) {
      setError('missing_fields')
      return
    }
    submit(() => api.auth.logIn({ username, password }))
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      {error && <FormError code={error} />}
      <TextField
        label={t('auth.fields.username')}
        autoComplete="username"
        ltr
        autoFocus
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <PasswordField
        label={t('auth.fields.password')}
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <SubmitButton pending={pending} label={t('auth.login.submit')} />
      {/* Demo only: one click fills in a seeded account's credentials */}
      {demoMode && (
        <div className="flex justify-end">
          <Menu
            label={t('auth.demoAccounts.title')}
            trigger={
              <>
                <KeyRound size={14} />
                {t('auth.demoAccounts.title')}
              </>
            }
            items={DEMO_ACCOUNTS.map((account) => ({
              label: (
                <span className="flex flex-col items-start gap-0.5">
                  <span className="flex items-center gap-2">
                    <bdi className="font-medium text-stone-900">
                      {account.companyName ?? account.fullName}
                    </bdi>
                    <span className="rounded bg-stone-100 px-1.5 text-[10px] font-semibold text-stone-600">
                      {t(`roles.${account.role}`)}
                    </span>
                  </span>
                  <span dir="ltr" className="font-mono text-xs whitespace-nowrap text-stone-500">
                    {account.username} · {account.password}
                  </span>
                </span>
              ),
              onSelect: () => {
                setUsername(account.username)
                setPassword(account.password)
                setError(null)
              }
            }))}
          />
        </div>
      )}
    </form>
  )
}

export default LoginForm
