import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle } from 'lucide-react'
import type {
  BranchRecord,
  IssuedPassword,
  MemberErrorCode,
  RoleRecord
} from '@masarat/shared/members'
import type { MembersAPI } from '@masarat/api-client'
import Modal from '../ui/Modal'
import { FormAlert, TextField } from '../form/fields'
import { useMountedRef } from '../../lib/useMountedRef'
import RoleFields from './RoleFields'

// Creates an account with a role (and branch); the API answers with its temporary password
function NewMemberDialog({
  members,
  roles,
  branches,
  onClose,
  onCreated
}: {
  members: MembersAPI
  roles: readonly RoleRecord[]
  branches: readonly BranchRecord[] | null
  onClose: () => void
  onCreated: (issued: IssuedPassword) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const titleId = useId()
  const mounted = useMountedRef()
  const [fullName, setFullName] = useState('')
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [assignment, setAssignment] = useState({ roleId: '', branchId: '' })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<MemberErrorCode | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!fullName.trim() || !username.trim() || !phone.trim() || !assignment.roleId) {
      setError('missing_fields')
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await members.create({
        fullName,
        username,
        phone,
        roleId: Number(assignment.roleId),
        branchId: assignment.branchId ? Number(assignment.branchId) : null
      })
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
        {t('members.form.title')}
      </h2>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {error && <FormAlert message={t(`members.errors.${error}`)} />}
        <TextField
          label={t('members.form.fullName')}
          autoComplete="off"
          autoFocus
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <TextField
          label={t('members.form.username')}
          hint={t('auth.fields.usernameHint')}
          autoComplete="off"
          ltr
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <TextField
          label={t('members.form.phone')}
          hint={t('members.form.phoneHint')}
          type="tel"
          autoComplete="off"
          ltr
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <RoleFields
          roles={roles}
          branches={branches}
          roleId={assignment.roleId}
          branchId={assignment.branchId}
          onChange={setAssignment}
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending && <LoaderCircle size={16} className="animate-spin" />}
            {t('members.form.submit')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default NewMemberDialog
