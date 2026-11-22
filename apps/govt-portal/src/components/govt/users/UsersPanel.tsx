import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, Plus, ShieldCheck } from 'lucide-react'
import type { GovtUserErrorCode, GovtUserRecord, IssuedPassword } from '@masarat/shared/govtUsers'
import { formatSudanPhone } from '@masarat/shared/phone'
import Menu from '@masarat/ui/components/ui/Menu'
import { FormAlert } from '@masarat/ui/components/form/fields'
import { useFormat } from '@masarat/ui/lib/format'
import { useMountedRef } from '@masarat/ui/lib/useMountedRef'
import { api } from '@masarat/api-client'
import ConfirmActionDialog, { type UserAction } from './ConfirmActionDialog'
import IssuedPasswordDialog from './IssuedPasswordDialog'
import NewUserDialog from './NewUserDialog'

type Dialog =
  | { kind: 'new' }
  | { kind: 'confirm'; action: UserAction; user: GovtUserRecord }
  | { kind: 'issued'; issued: IssuedPassword; reset: boolean }

function StatusBadge({ user }: { user: GovtUserRecord }): React.JSX.Element {
  const { t } = useTranslation()
  if (user.disabled) {
    return (
      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
        {t('govt.users.statuses.disabled')}
      </span>
    )
  }
  return (
    <span className="flex flex-wrap gap-1">
      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-800">
        {t('govt.users.statuses.active')}
      </span>
      {user.mustChangePassword && (
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
          {t('govt.users.statuses.mustChange')}
        </span>
      )}
    </span>
  )
}

// Government portal → Users (admins only): the government accounts and what an admin can do to
// them. The admin's own row has no actions.
function UsersPanel({ currentUserId }: { currentUserId: number }): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const mounted = useMountedRef()
  const [users, setUsers] = useState<GovtUserRecord[] | null>(null)
  const [error, setError] = useState<GovtUserErrorCode | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)

  // Bumped after every change, to load the list again
  const [version, setVersion] = useState(0)
  const reload = (): void => setVersion((v) => v + 1)

  useEffect(() => {
    api.govt.users
      .list()
      .then((result) => {
        if (!mounted.current) return
        if (!result.ok) return setError(result.error)
        setUsers(result.data)
        setError(null)
      })
      .catch(() => mounted.current && setError('unknown'))
  }, [mounted, version])

  const actionsFor = (user: GovtUserRecord): UserAction[] => [
    user.disabled ? 'enable' : 'disable',
    'resetPassword',
    user.isAdmin ? 'removeAdmin' : 'makeAdmin'
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">{t('govt.users.title')}</h2>
          <p className="max-w-2xl text-sm text-stone-500">{t('govt.users.subtitle')}</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setDialog({ kind: 'new' })}
        >
          <Plus size={16} />
          {t('govt.users.new')}
        </button>
      </div>

      {error && <FormAlert message={t(`govt.users.errors.${error}`)} />}

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
                <th>{t('govt.users.columns.name')}</th>
                <th>{t('govt.users.columns.username')}</th>
                <th>{t('govt.users.columns.phone')}</th>
                <th>{t('govt.users.columns.role')}</th>
                <th>{t('govt.users.columns.status')}</th>
                <th>{t('govt.users.columns.created')}</th>
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
                        ({t('govt.users.you')})
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
                    {user.isAdmin ? (
                      <span className="flex items-center gap-1 text-brand-800">
                        <ShieldCheck size={14} />
                        {t('govt.users.roles.admin')}
                      </span>
                    ) : (
                      t('govt.users.roles.staff')
                    )}
                  </td>
                  <td>
                    <StatusBadge user={user} />
                  </td>
                  <td className="whitespace-nowrap tabular-nums">{format.date(user.createdAt)}</td>
                  <td>
                    {user.id !== currentUserId && (
                      <Menu
                        label={t('govt.users.actions.menu', { name: user.fullName })}
                        items={actionsFor(user).map((action) => ({
                          label: t(`govt.users.actions.${action}`),
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
            <p className="py-10 text-center text-sm text-stone-500">{t('govt.users.empty')}</p>
          )}
        </div>
      )}

      {dialog?.kind === 'new' && (
        <NewUserDialog
          onClose={() => setDialog(null)}
          onCreated={(issued) => {
            setDialog({ kind: 'issued', issued, reset: false })
            reload()
          }}
        />
      )}
      {dialog?.kind === 'confirm' && (
        <ConfirmActionDialog
          action={dialog.action}
          user={dialog.user}
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

export default UsersPanel
