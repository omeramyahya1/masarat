import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Info, LoaderCircle } from 'lucide-react'
import {
  MAX_ADDRESS_LENGTH,
  MAX_TIN_LENGTH,
  type AuthErrorCode,
  type AuthUser,
  type CompanyInput,
  type CompanyProfile,
  type ProfileInput
} from '@masarat/shared/auth'
import { FormError, SubmitButton, TextField } from '@masarat/ui/components/auth/fields'
import { useAuthSubmit } from '@masarat/ui/components/auth/useAuthSubmit'
import { FormAlert } from '@masarat/ui/components/form/fields'
import { useCan } from '@masarat/ui/lib/account'
import { useMountedRef } from '@masarat/ui/lib/useMountedRef'
import { api } from '@masarat/api-client'

const profileFrom = (user: AuthUser): ProfileInput => ({
  fullName: user.fullName,
  phone: user.phone
})

const companyFrom = (company: CompanyProfile): CompanyInput => ({
  name: company.name,
  address: company.address ?? '',
  tin: company.tin ?? ''
})

// The member's own name and phone
function OwnDetails({
  user,
  onUserChange
}: {
  user: AuthUser
  onUserChange: (user: AuthUser) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [form, setForm] = useState<ProfileInput>(() => profileFrom(user))
  const [saved, setSaved] = useState(false)
  const { error, pending, setError, submit } = useAuthSubmit((updated) => {
    onUserChange(updated)
    setForm(profileFrom(updated))
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
    if (!form.fullName.trim() || !form.phone.trim()) {
      setError('missing_fields')
      return
    }
    submit(() => api.auth.updateProfile(form))
  }

  return (
    <form className="card flex max-w-2xl flex-col gap-5 p-6" onSubmit={handleSubmit} noValidate>
      <h3 className="text-sm font-semibold text-stone-900">{t('profile.yourDetails')}</h3>
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
          hint={t('auth.fields.phoneHint')}
          type="tel"
          autoComplete="tel"
          ltr
          {...bind('phone')}
        />
      </div>
      <div className="flex justify-end border-t border-stone-200 pt-5">
        <SubmitButton pending={pending} className="" label={t('profile.save')} />
      </div>
    </form>
  )
}

// The company's carrier details, editable with company.profile
function CompanyDetails({
  user,
  onUserChange
}: {
  user: AuthUser
  onUserChange: (user: AuthUser) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const mounted = useMountedRef()
  const editable = useCan()('company.profile')
  const company = user.company
  const [form, setForm] = useState<CompanyInput | null>(() =>
    company ? companyFrom(company) : null
  )
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AuthErrorCode | null>(null)
  if (!company || !form) return null

  const bind = (
    key: keyof CompanyInput
  ): { value: string; onChange: (e: ChangeEvent<HTMLInputElement>) => void } => ({
    value: form[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setSaved(false)
      setForm({ ...form, [key]: e.target.value })
    }
  })

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!form.name.trim()) return setError('missing_fields')
    setPending(true)
    setError(null)
    try {
      const result = await api.company.update(form)
      if (!mounted.current) return
      if (!result.ok) return setError(result.error)
      onUserChange({ ...user, company: result.data })
      setForm(companyFrom(result.data))
      setSaved(true)
    } catch {
      if (mounted.current) setError('unknown')
    } finally {
      if (mounted.current) setPending(false)
    }
  }

  return (
    <form className="card flex max-w-2xl flex-col gap-5 p-6" onSubmit={handleSubmit} noValidate>
      <h3 className="text-sm font-semibold text-stone-900">{t('profile.carrier')}</h3>
      {error && <FormError code={error} />}
      {saved && <FormAlert tone="success" message={t('profile.companySaved')} />}
      <fieldset disabled={!editable} className="flex flex-col gap-5">
        <TextField
          label={t('auth.fields.companyName')}
          hint={t('profile.companyHint')}
          autoComplete="organization"
          dir="auto"
          {...bind('name')}
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
      </fieldset>
      <p className="flex gap-2 text-xs text-stone-500">
        <Info size={14} className="mt-0.5 shrink-0" />
        {t(editable ? 'profile.carrierNote' : 'profile.carrierReadOnly')}
      </p>
      {editable && (
        <div className="flex justify-end border-t border-stone-200 pt-5">
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending && <LoaderCircle size={16} className="animate-spin" />}
            {t('profile.saveCompany')}
          </button>
        </div>
      )}
    </form>
  )
}

// The member's own details, and the company's details printed on its manifests as the carrier
function ProfilePanel({
  user,
  onUserChange
}: {
  user: AuthUser
  onUserChange: (user: AuthUser) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-stone-900">{t('profile.title')}</h2>
        <p className="text-sm text-stone-500">{t('profile.subtitle')}</p>
      </div>
      <OwnDetails user={user} onUserChange={onUserChange} />
      <CompanyDetails user={user} onUserChange={onUserChange} />
    </section>
  )
}

export default ProfilePanel
