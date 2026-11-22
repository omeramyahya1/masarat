import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle } from 'lucide-react'
import type {
  BranchRecord,
  IssuedPassword,
  MemberErrorCode,
  MemberRecord,
  MemberResult,
  RoleRecord
} from '@masarat/shared/members'
import type { MembersAPI } from '@masarat/api-client'
import Modal from '../ui/Modal'
import { FormAlert } from '../form/fields'
import { useMountedRef } from '../../lib/useMountedRef'
import RoleFields from './RoleFields'

export type MemberAction = 'disable' | 'enable' | 'resetPassword' | 'changeRole'

const DANGEROUS: readonly MemberAction[] = ['disable', 'resetPassword']

// Confirms one action on an account and runs it. Changing the role also picks the new role (and
// branch); a password reset shows the new temporary password next.
function ConfirmActionDialog({
  members,
  action,
  user,
  roles,
  branches,
  onClose,
  onDone
}: {
  members: MembersAPI
  action: MemberAction
  user: MemberRecord
  roles: readonly RoleRecord[]
  branches: readonly BranchRecord[] | null
  onClose: () => void
  onDone: (result: MemberRecord | IssuedPassword) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const titleId = useId()
  const mounted = useMountedRef()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<MemberErrorCode | null>(null)
  const [assignment, setAssignment] = useState({
    roleId: String(user.role.id),
    branchId: user.branch ? String(user.branch.id) : ''
  })

  const run = (): Promise<MemberResult<MemberRecord | IssuedPassword>> => {
    switch (action) {
      case 'disable':
        return members.disable(user.id)
      case 'enable':
        return members.enable(user.id)
      case 'resetPassword':
        return members.resetPassword(user.id)
      case 'changeRole':
        return members.changeRole(user.id, {
          roleId: Number(assignment.roleId),
          branchId: assignment.branchId ? Number(assignment.branchId) : null
        })
    }
  }

  const confirm = async (): Promise<void> => {
    setPending(true)
    setError(null)
    try {
      const result = await run()
      if (result.ok) return onDone(result.data)
      if (mounted.current) setError(result.error)
    } catch {
      if (mounted.current) setError('unknown')
    }
    if (mounted.current) setPending(false)
  }

  const key = `members.confirm.${action}`
  return (
    <Modal labelledBy={titleId} onClose={() => !pending && onClose()}>
      <h2 id={titleId} className="mb-2 text-lg font-semibold">
        {t(`${key}.title`, { name: user.fullName })}
      </h2>
      <p className="mb-4 text-sm text-stone-600">{t(`${key}.body`)}</p>
      {action === 'changeRole' && (
        <div className="mb-4 flex flex-col gap-4">
          <RoleFields
            roles={roles}
            branches={branches}
            roleId={assignment.roleId}
            branchId={assignment.branchId}
            onChange={setAssignment}
          />
        </div>
      )}
      {error && (
        <div className="mb-4">
          <FormAlert message={t(`members.errors.${error}`)} />
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
