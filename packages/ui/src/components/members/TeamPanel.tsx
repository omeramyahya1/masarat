import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, Plus } from 'lucide-react'
import type {
  BranchRecord,
  IssuedPassword,
  MemberErrorCode,
  MemberRecord,
  RoleRecord
} from '@masarat/shared/members'
import type { UserKind } from '@masarat/shared/permissions'
import { formatSudanPhone } from '@masarat/shared/phone'
import type { MembersAPI } from '@masarat/api-client'
import Menu from '../ui/Menu'
import { FormAlert } from '../form/fields'
import { useAccount, useRoleName } from '../../lib/account'
import { useFormat } from '../../lib/format'
import { useMountedRef } from '../../lib/useMountedRef'
import ConfirmActionDialog, { type MemberAction } from './ConfirmActionDialog'
import IssuedPasswordDialog from './IssuedPasswordDialog'
import NewMemberDialog from './NewMemberDialog'

type Dialog =
  | { kind: 'new' }
  | { kind: 'confirm'; action: MemberAction; user: MemberRecord }
  | { kind: 'issued'; issued: IssuedPassword; reset: boolean }

function StatusBadge({ user }: { user: MemberRecord }): React.JSX.Element {
  const { t } = useTranslation()
  if (user.disabled) {
    return (
      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
        {t('members.statuses.disabled')}
      </span>
    )
  }
  return (
    <span className="flex flex-wrap gap-1">
      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800">
        {t('members.statuses.active')}
      </span>
      {user.mustChangePassword && (
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
          {t('members.statuses.mustChange')}
        </span>
      )}
    </span>
  )
}

// The accounts an admin manages: a company's Team (with each member's branch), or the government's
// Users. The admin's own row has no actions.
function TeamPanel({
  side,
  members,
  branches = null
}: {
  side: UserKind
  members: MembersAPI
  // The company's branches; null on the government's side
  branches?: readonly BranchRecord[] | null
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const roleName = useRoleName()
  const mounted = useMountedRef()
  const { id: currentUserId } = useAccount()
  const [users, setUsers] = useState<MemberRecord[] | null>(null)
  const [roles, setRoles] = useState<RoleRecord[]>([])
  const [error, setError] = useState<MemberErrorCode | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)

  // Bumped after every change, to load the list again
  const [version, setVersion] = useState(0)
  const reload = (): void => setVersion((v) => v + 1)

  useEffect(() => {
    Promise.all([members.list(), members.roles()])
      .then(([list, roleList]) => {
        if (!mounted.current) return
        if (!list.ok) return setError(list.error)
        setUsers(list.data)
        if (roleList.ok) setRoles(roleList.data)
        setError(null)
      })
      .catch(() => mounted.current && setError('unknown'))
  }, [members, mounted, version])

  const actionsFor = (user: MemberRecord): MemberAction[] => [
    user.disabled ? 'enable' : 'disable',
    'resetPassword',
    'changeRole'
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">{t(`members.title.${side}`)}</h2>
          <p className="max-w-2xl text-sm text-stone-500">{t(`members.subtitle.${side}`)}</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={roles.length === 0}
          onClick={() => setDialog({ kind: 'new' })}
        >
          <Plus size={16} />
          {t('members.new')}
        </button>
      </div>

      {error && <FormAlert message={t(`members.errors.${error}`)} />}

      {users === null ? (
        !error && (
          <div className="flex justify-center py-10" role="status" aria-label={t('shell.loading')}>
            <LoaderCircle size={24} className="animate-spin text-brand-700" />
          </div>
        )
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('members.columns.name')}</th>
                <th>{t('members.columns.username')}</th>
                <th>{t('members.columns.phone')}</th>
                <th>{t('members.columns.role')}</th>
                <th>{t('members.columns.status')}</th>
                <th>{t('members.columns.created')}</th>
                <th className="w-0">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className={user.disabled ? 'text-stone-400' : undefined}>
                  <td className="font-medium text-stone-900">
                    <bdi>{user.fullName}</bdi>
                    {user.id === currentUserId && (
                      <span className="ms-2 text-xs font-normal text-stone-500">
                        ({t('members.you')})
                      </span>
                    )}
                  </td>
                  <td>
                    <bdi dir="ltr" className="font-mono text-xs">
                      {user.username}
                    </bdi>
                  </td>
                  <td>
                    <bdi dir="ltr" className="tabular-nums">
                      {formatSudanPhone(user.phone)}
                    </bdi>
                  </td>
                  <td>
                    <div>{roleName(user.role)}</div>
                    {user.branch && (
                      <bdi className="text-xs text-stone-500">{user.branch.name}</bdi>
                    )}
                  </td>
                  <td>
                    <StatusBadge user={user} />
                  </td>
                  <td className="whitespace-nowrap tabular-nums">{format.date(user.createdAt)}</td>
                  <td>
                    {user.id !== currentUserId && (
                      <Menu
                        label={t('members.actions.menu', { name: user.fullName })}
                        items={actionsFor(user).map((action) => ({
                          label: t(`members.actions.${action}`),
                          onSelect: () => setDialog({ kind: 'confirm', action, user })
                        }))}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <p className="py-10 text-center text-sm text-stone-500">{t('members.empty')}</p>
          )}
        </div>
      )}

      {dialog?.kind === 'new' && (
        <NewMemberDialog
          members={members}
          roles={roles}
          branches={branches}
          onClose={() => setDialog(null)}
          onCreated={(issued) => {
            setDialog({ kind: 'issued', issued, reset: false })
            reload()
          }}
        />
      )}
      {dialog?.kind === 'confirm' && (
        <ConfirmActionDialog
          members={members}
          action={dialog.action}
          user={dialog.user}
          roles={roles}
          branches={branches}
          onClose={() => setDialog(null)}
          onDone={(result) => {
            setDialog(
              'temporaryPassword' in result ? { kind: 'issued', issued: result, reset: true } : null
            )
            reload()
          }}
        />
      )}
      {dialog?.kind === 'issued' && (
        <IssuedPasswordDialog
          issued={dialog.issued}
          reset={dialog.reset}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

export default TeamPanel
