import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { PASSWORD_MIN_LENGTH, type AuthUser } from '@masarat/shared/auth'
import { FormError, PasswordField, SubmitButton } from '@masarat/ui/components/auth/fields'
import { useAuthSubmit } from '@masarat/ui/components/auth/useAuthSubmit'
import { api } from '@masarat/api-client'

// Replaces the user's password; required before anything else when it's a temporary one
function ChangePasswordForm({
  onChanged
}: {
  onChanged: (user: AuthUser) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const { error, pending, setError, submit } = useAuthSubmit(onChanged)

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!current || !next) {
      setError('missing_fields')
      return
    }
    if (next !== confirm) {
      setError('password_mismatch')
      return
    }
    submit(() => api.auth.changePassword({ currentPassword: current, newPassword: next }))
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      {error && <FormError code={error} />}
      <PasswordField
        label={t('auth.changePassword.current')}
        autoComplete="current-password"
        autoFocus
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <PasswordField
        label={t('auth.changePassword.new')}
        hint={t('auth.fields.passwordHint', { min: PASSWORD_MIN_LENGTH })}
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      <PasswordField
        label={t('auth.changePassword.confirm')}
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      <SubmitButton pending={pending} label={t('auth.changePassword.submit')} />
    </form>
  )
}

export default ChangePasswordForm
