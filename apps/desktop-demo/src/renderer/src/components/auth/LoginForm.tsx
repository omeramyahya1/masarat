import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound } from 'lucide-react'
import type { AuthUser, UserRole } from '../../../../shared/auth'
import { demoAccountsFor } from '../../../../shared/demo'
import Menu from '../ui/Menu'
import { FormError, PasswordField, SubmitButton, TextField } from './fields'
import { useAuthSubmit } from './useAuthSubmit'

interface LoginFormProps {
  role: UserRole
  onAuthenticated: (user: AuthUser) => void
}

function LoginForm({ role, onAuthenticated }: LoginFormProps): React.JSX.Element {
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
    submit(() => window.api.auth.logIn({ role, username, password }))
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
      <div className="flex justify-end">
        <Menu
          label={t('auth.demoAccounts.title')}
          trigger={
            <>
              <KeyRound size={14} />
              {t('auth.demoAccounts.title')}
            </>
          }
          items={demoAccountsFor(role).map((account) => ({
            label: (
              <span className="flex flex-col items-start gap-0.5">
                <bdi className="font-medium text-stone-900">
                  {account.companyName ?? account.fullName}
                </bdi>
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
    </form>
  )
}

export default LoginForm
