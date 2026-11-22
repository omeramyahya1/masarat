import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle } from 'lucide-react'
import type { GovtUserErrorCode, IssuedPassword } from '@masarat/shared/govtUsers'
import Modal from '@masarat/ui/components/ui/Modal'
import { FormAlert, TextField } from '@masarat/ui/components/form/fields'
import { useMountedRef } from '@masarat/ui/lib/useMountedRef'
import { api } from '@masarat/api-client'

// Creates a government account; the API answers with its temporary password
function NewUserDialog({
  onClose,
  onCreated
}: {
  onClose: () => void
  onCreated: (issued: IssuedPassword) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const titleId = useId()
  const adminId = useId()
  const mounted = useMountedRef()
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<GovtUserErrorCode | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!fullName.trim() || !username.trim()) {
      setError('missing_fields')
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await api.govt.users.create({ fullName, username, phone, isAdmin })
      if (result.ok) return onCreated(result.data)
      if (mounted.current) setError(result.error)
    } catch {
      if (mounted.current) setError('unknown')
    }
    if (mounted.current) setPending(false)
  }

  return (
    <Modal labelledBy={titleId} onClose={() => !pending && onClose()}>
      <h2 id={titleId} className="mb-4 text-lg font-semibold">
        {t('govt.users.form.title')}
      </h2>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {error && <FormAlert message={t(`govt.users.errors.${error}`)} />}
        <TextField
          label={t('govt.users.form.fullName')}
          autoComplete="off"
          autoFocus
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <TextField
          label={t('govt.users.form.username')}
          hint={t('auth.fields.usernameHint')}
          autoComplete="off"
          ltr
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <TextField
          label={t('govt.users.form.phone')}
          type="tel"
          autoComplete="off"
          ltr
          optional
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <label htmlFor={adminId} className="flex items-center gap-2 text-sm text-stone-700">
          <input
            id={adminId}
            type="checkbox"
            className="size-4 accent-brand-700"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
          />
          {t('govt.users.form.isAdmin')}
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending && <LoaderCircle size={16} className="animate-spin" />}
            {t('govt.users.form.submit')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default NewUserDialog
