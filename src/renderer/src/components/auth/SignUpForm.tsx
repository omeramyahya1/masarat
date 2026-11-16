import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { PASSWORD_MIN_LENGTH, type AuthUser, type UserRole } from '../../../../shared/auth'
import { FormError, PasswordField, SubmitButton, TextField } from './fields'
import { useAuthSubmit } from './useAuthSubmit'

interface SignUpFormProps {
  role: UserRole
  onAuthenticated: (user: AuthUser) => void
}

const EMPTY_FORM = {
  fullName: '',
  username: '',
  phone: '',
  companyName: '',
  password: '',
  confirmPassword: ''
}

type FormState = typeof EMPTY_FORM

function SignUpForm({ role, onAuthenticated }: SignUpFormProps): React.JSX.Element {
  const { t } = useTranslation()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const { error, pending, setError, submit } = useAuthSubmit(onAuthenticated)

  const bind = (
    key: keyof FormState
  ): { value: string; onChange: (e: ChangeEvent<HTMLInputElement>) => void } => ({
    value: form[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value })
  })

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!form.fullName.trim() || !form.username.trim() || !form.password) {
      setError('missing_fields')
      return
    }
    if (form.password !== form.confirmPassword) {
      setError('password_mismatch')
      return
    }
    const { fullName, username, phone, companyName, password } = form
    submit(() => window.api.auth.signUp({ role, fullName, username, phone, companyName, password }))
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
      {error && <FormError code={error} />}
      <TextField
        label={t('auth.fields.fullName')}
        autoComplete="name"
        autoFocus
        {...bind('fullName')}
      />
      <TextField
        label={t('auth.fields.username')}
        hint={t('auth.fields.usernameHint')}
        autoComplete="username"
        ltr
        {...bind('username')}
      />
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label={t('auth.fields.phone')}
          type="tel"
          autoComplete="tel"
          ltr
          optional
          {...bind('phone')}
        />
        {role === 'owner' && (
          <TextField
            label={t('auth.fields.companyName')}
            autoComplete="organization"
            optional
            {...bind('companyName')}
          />
        )}
      </div>
      <PasswordField
        label={t('auth.fields.password')}
        hint={t('auth.fields.passwordHint', { min: PASSWORD_MIN_LENGTH })}
        autoComplete="new-password"
        {...bind('password')}
      />
      <PasswordField
        label={t('auth.fields.confirmPassword')}
        autoComplete="new-password"
        {...bind('confirmPassword')}
      />
      <SubmitButton pending={pending} label={t('auth.signup.submit')} />
    </form>
  )
}

export default SignUpForm
