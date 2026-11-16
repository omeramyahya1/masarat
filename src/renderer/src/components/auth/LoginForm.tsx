import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { AuthUser, UserRole } from '../../../../shared/auth'
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
    </form>
  )
}

export default LoginForm
