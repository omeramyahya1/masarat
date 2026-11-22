import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MAX_ADDRESS_LENGTH,
  MAX_TIN_LENGTH,
  PASSWORD_MIN_LENGTH,
  type AuthUser
} from '@masarat/shared/auth'
import {
  FormError,
  PasswordField,
  SubmitButton,
  TextField
} from '@masarat/ui/components/auth/fields'
import { useAuthSubmit } from '@masarat/ui/components/auth/useAuthSubmit'
import { api } from '@masarat/api-client'

interface SignUpFormProps {
  onAuthenticated: (user: AuthUser) => void
}

const EMPTY_FORM = {
  fullName: '',
  username: '',
  phone: '',
  companyName: '',
  address: '',
  tin: '',
  password: '',
  confirmPassword: ''
}

type FormState = typeof EMPTY_FORM

// Fleet owners only: government accounts are created by a government admin
function SignUpForm({ onAuthenticated }: SignUpFormProps): React.JSX.Element {
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
    if (!form.fullName.trim() || !form.username.trim() || !form.phone.trim() || !form.password) {
      setError('missing_fields')
      return
    }
    if (form.password !== form.confirmPassword) {
      setError('password_mismatch')
      return
    }
    const { fullName, username, phone, companyName, address, tin, password } = form
    submit(() =>
      api.auth.signUp({
        fullName,
        username,
        phone,
        companyName,
        address,
        tin,
        password
      })
    )
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
          hint={t('auth.fields.phoneHint')}
          type="tel"
          autoComplete="tel"
          ltr
          {...bind('phone')}
        />
        <TextField
          label={t('auth.fields.companyName')}
          autoComplete="organization"
          optional
          {...bind('companyName')}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <TextField
          label={t('auth.fields.address')}
          maxLength={MAX_ADDRESS_LENGTH}
          autoComplete="street-address"
          optional
          {...bind('address')}
        />
        <TextField
          label={t('auth.fields.tin')}
          maxLength={MAX_TIN_LENGTH}
          autoComplete="off"
          ltr
          optional
          {...bind('tin')}
        />
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
