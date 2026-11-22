import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle } from 'lucide-react'
import type {
  GovtUserErrorCode,
  GovtUserRecord,
  GovtUserResult,
  IssuedPassword
} from '@masarat/shared/govtUsers'
import Modal from '@masarat/ui/components/ui/Modal'
import { FormAlert } from '@masarat/ui/components/form/fields'
import { useMountedRef } from '@masarat/ui/lib/useMountedRef'
import { api } from '@masarat/api-client'

export type UserAction = 'disable' | 'enable' | 'resetPassword' | 'makeAdmin' | 'removeAdmin'

const DANGEROUS: readonly UserAction[] = ['disable', 'resetPassword', 'removeAdmin']

// What each action calls; a password reset also shows the new temporary password
const runAction = (
  action: UserAction,
  user: GovtUserRecord
): Promise<GovtUserResult<GovtUserRecord | IssuedPassword>> => {
  switch (action) {
    case 'disable':
      return api.govt.users.disable(user.id)
    case 'enable':
      return api.govt.users.enable(user.id)
    case 'resetPassword':
      return api.govt.users.resetPassword(user.id)
    case 'makeAdmin':
      return api.govt.users.setAdmin(user.id, true)
    case 'removeAdmin':
      return api.govt.users.setAdmin(user.id, false)
  }
}

// Confirms one action on a government account and runs it
function ConfirmActionDialog({
  action,
  user,
  onClose,
  onDone
}: {
  action: UserAction
  user: GovtUserRecord
  onClose: () => void
  onDone: (result: GovtUserRecord | IssuedPassword) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const titleId = useId()
  const mounted = useMountedRef()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<GovtUserErrorCode | null>(null)

  const confirm = async (): Promise<void> => {
    setPending(true)
    setError(null)
    try {
      const result = await runAction(action, user)
      if (result.ok) return onDone(result.data)
      if (mounted.current) setError(result.error)
    } catch {
      if (mounted.current) setError('unknown')
    }
    if (mounted.current) setPending(false)
  }

  const key = `govt.users.confirm.${action}`
  return (
    <Modal labelledBy={titleId} onClose={() => !pending && onClose()}>
      <h2 id={titleId} className="mb-2 text-lg font-semibold">
        {t(`${key}.title`, { name: user.fullName })}
      </h2>
      <p className="mb-4 text-sm text-stone-600">{t(`${key}.body`)}</p>
      {error && (
        <div className="mb-4">
          <FormAlert message={t(`govt.users.errors.${error}`)} />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className={DANGEROUS.includes(action) ? 'btn btn-danger' : 'btn btn-primary'}
          disabled={pending}
          onClick={confirm}
        >
          {pending && <LoaderCircle size={16} className="animate-spin" />}
          {t(`${key}.submit`)}
        </button>
      </div>
    </Modal>
  )
}

export default ConfirmActionDialog
