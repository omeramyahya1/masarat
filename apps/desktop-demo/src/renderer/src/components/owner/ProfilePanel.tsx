import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Info } from 'lucide-react'
import {
  MAX_ADDRESS_LENGTH,
  MAX_TIN_LENGTH,
  type AuthUser,
  type ProfileInput
} from '../../../../shared/auth'
import { FormError, SubmitButton, TextField } from '../auth/fields'
import { useAuthSubmit } from '../auth/useAuthSubmit'
import { FormAlert } from '../form/fields'

const formFrom = (user: AuthUser): ProfileInput => ({
  fullName: user.fullName,
  phone: user.phone ?? '',
  companyName: user.companyName ?? '',
  address: user.address ?? '',
  tin: user.tin ?? ''
})

// The fleet owner's own details. The company, address and TIN are printed on their manifests as
// the carrier.
function ProfilePanel({
  user,
  onUserChange
}: {
  user: AuthUser
  onUserChange: (user: AuthUser) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [form, setForm] = useState<ProfileInput>(() => formFrom(user))
  const [saved, setSaved] = useState(false)
  const { error, pending, setError, submit } = useAuthSubmit((updated) => {
    onUserChange(updated)
    setForm(formFrom(updated))
    setSaved(true)
  })

  const bind = (
    key: keyof ProfileInput
  ): { value: string; onChange: (e: ChangeEvent<HTMLInputElement>) => void } => ({
    value: form[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setSaved(false)
      setForm({ ...form, [key]: e.target.value })
    }
  })

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (!form.fullName.trim()) {
      setError('missing_fields')
      return
    }
    submit(() => window.api.auth.updateProfile(form))
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-stone-900">{t('profile.title')}</h2>
        <p className="text-sm text-stone-500">{t('profile.subtitle')}</p>
      </div>

      <form className="card flex max-w-2xl flex-col gap-5 p-6" onSubmit={handleSubmit} noValidate>
        {error && <FormError code={error} />}
        {saved && <FormAlert tone="success" message={t('profile.saved')} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t('auth.fields.fullName')}
            autoComplete="name"
            dir="auto"
            {...bind('fullName')}
          />
          <TextField
            label={t('auth.fields.phone')}
            type="tel"
            autoComplete="tel"
            ltr
            optional
            {...bind('phone')}
          />
        </div>

        <h3 className="border-t border-stone-200 pt-5 text-sm font-semibold text-stone-900">
          {t('profile.carrier')}
        </h3>
        <TextField
          label={t('auth.fields.companyName')}
          hint={t('profile.companyHint')}
          autoComplete="organization"
          dir="auto"
          {...bind('companyName')}
        />
        <TextField
          label={t('auth.fields.address')}
          maxLength={MAX_ADDRESS_LENGTH}
          autoComplete="street-address"
          dir="auto"
          {...bind('address')}
        />
        <TextField
          label={t('auth.fields.tin')}
          hint={t('auth.fields.tinHint')}
          maxLength={MAX_TIN_LENGTH}
          autoComplete="off"
          ltr
          {...bind('tin')}
        />
        <p className="flex gap-2 text-xs text-stone-500">
          <Info size={14} className="mt-0.5 shrink-0" />
          {t('profile.carrierNote')}
        </p>

        <div className="flex justify-end border-t border-stone-200 pt-5">
          <SubmitButton pending={pending} className="" label={t('profile.save')} />
        </div>
      </form>
    </section>
  )
}

export default ProfilePanel
