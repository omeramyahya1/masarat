import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useRoles } from '@masarat/ui/lib/queries'
import { errorCode, queryClient, queryKeys } from '@masarat/ui/lib/query'
import { Lock, LoaderCircle, Pencil, Plus, Trash2 } from 'lucide-react'
import {
  MAX_ROLE_NAME_LENGTH,
  type MemberErrorCode,
  type RoleRecord
} from '@masarat/shared/members'
import {
  COMPANY_PERMISSION_GROUPS,
  ROLE_SCOPES,
  isCompanyPermission,
  withImplied,
  type CompanyPermission,
  type RoleScope
} from '@masarat/shared/permissions'
import { FormAlert, TextField } from '@masarat/ui/components/form/fields'
import Modal from '@masarat/ui/components/ui/Modal'
import { useRoleName } from '@masarat/ui/lib/account'
import { useFormat } from '@masarat/ui/lib/format'
import { useMountedRef } from '@masarat/ui/lib/useMountedRef'
import { api } from '@masarat/api-client'

// A role's name, reach and permissions, ticked group by group. Ticking a "manage" or "edit"
// permission also ticks the "view" it needs.
function RoleDialog({
  role,
  onClose,
  onSaved
}: {
  role: RoleRecord | null
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const roleName = useRoleName()
  const titleId = useId()
  const baseId = useId()
  const mounted = useMountedRef()
  const [name, setName] = useState(role ? roleName(role) : '')
  const [scope, setScope] = useState<RoleScope>(role?.scope ?? 'branch')
  const [permissions, setPermissions] = useState<CompanyPermission[]>(
    () => role?.permissions.filter(isCompanyPermission) ?? ['trips.view']
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<MemberErrorCode | null>(null)

  const toggle = (permission: CompanyPermission, on: boolean): void =>
    setPermissions((current) =>
      on ? withImplied([...current, permission]) : current.filter((p) => p !== permission)
    )

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!name.trim() || permissions.length === 0) return setError('missing_fields')
    setPending(true)
    setError(null)
    try {
      const input = { name, scope, permissions }
      const result = role
        ? await api.company.updateRole(role.id, input)
        : await api.company.addRole(input)
      if (result.ok) return onSaved()
      if (mounted.current) setError(result.error)
    } catch {
      if (mounted.current) setError('unknown')
    }
    if (mounted.current) setPending(false)
  }

  return (
    <Modal labelledBy={titleId} className="max-w-lg" onClose={() => !pending && onClose()}>
      <h2 id={titleId} className="mb-4 text-lg font-semibold">
        {t(role ? 'roles.form.editTitle' : 'roles.form.title')}
      </h2>
      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        {error && <FormAlert message={t(`members.errors.${error}`)} />}
        <TextField
          label={t('roles.form.name')}
          maxLength={MAX_ROLE_NAME_LENGTH}
          dir="auto"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="label mb-1">{t('roles.form.scope')}</legend>
          {ROLE_SCOPES.map((value) => (
            <label key={value} className="flex items-start gap-2 text-sm text-stone-700">
              <input
                type="radio"
                name={`${baseId}-scope`}
                className="mt-0.5 size-4 accent-brand-700"
                checked={scope === value}
                disabled={role !== null && role.memberCount > 0 && scope !== value}
                onChange={() => setScope(value)}
              />
              <span>{t(`members.scopes.${value}`)}</span>
            </label>
          ))}
          {role !== null && role.memberCount > 0 && (
            <p className="field-hint">{t('roles.form.scopeLocked')}</p>
          )}
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className="label mb-1">{t('roles.form.permissions')}</legend>
          {Object.entries(COMPANY_PERMISSION_GROUPS).map(([group, list]) => (
            <div key={group} className="rounded-lg border border-stone-200 p-3">
              <p className="mb-2 text-xs font-semibold text-stone-600">
                {t(`roles.groups.${group}`)}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {list.map((permission) => (
                  <label
                    key={permission}
                    className="flex items-center gap-2 text-sm text-stone-700"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-brand-700"
                      checked={permissions.includes(permission)}
                      onChange={(e) => toggle(permission, e.target.checked)}
                    />
                    {t(`permissions.${permission.replace('.', '_')}`)}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" disabled={pending} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending && <LoaderCircle size={16} className="animate-spin" />}
            {t('roles.form.save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// The company's roles: the built-in three (the company admin can't be edited) and its own
function RolesPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const roleName = useRoleName()
  const mounted = useMountedRef()
  // The cached roles (lib/queries.ts); the Team section's role list follows them
  const rolesQuery = useRoles()
  const roles = rolesQuery.data ?? null
  const [actionError, setError] = useState<MemberErrorCode | null>(null)
  const error = actionError ?? errorCode<MemberErrorCode>(rolesQuery.error)
  const [editing, setEditing] = useState<RoleRecord | 'new' | null>(null)
  const reload = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.roles })
    void queryClient.invalidateQueries({ queryKey: queryKeys.members('company') })
  }

  const remove = async (role: RoleRecord): Promise<void> => {
    setError(null)
    try {
      const result = await api.company.deleteRole(role.id)
      if (!mounted.current) return
      if (!result.ok) return setError(result.error)
      reload()
    } catch {
      if (mounted.current) setError('unknown')
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">{t('roles.title')}</h2>
          <p className="max-w-2xl text-sm text-stone-500">{t('roles.subtitle')}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          <Plus size={16} />
          {t('roles.add')}
        </button>
      </div>

      {error && <FormAlert message={t(`members.errors.${error}`)} />}

      {roles === null ? (
        !error && (
          <div className="flex justify-center py-16 text-stone-400">
            <LoaderCircle className="animate-spin" />
          </div>
        )
      ) : (
        <div className="card overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('roles.columns.name')}</th>
                <th>{t('roles.columns.scope')}</th>
                <th>{t('roles.columns.permissions')}</th>
                <th>{t('roles.columns.members')}</th>
                <th className="w-0">
                  <span className="sr-only">{t('common.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id}>
                  <td className="font-medium text-stone-900">
                    <span className="inline-flex items-center gap-1.5">
                      {role.locked && <Lock size={14} className="text-stone-400" />}
                      <bdi>{roleName(role)}</bdi>
                    </span>
                  </td>
                  <td>{t(`roles.scopes.${role.scope}`)}</td>
                  <td className="max-w-md text-xs text-stone-600">
                    {role.locked
                      ? t('roles.everything')
                      : format.list(
                          role.permissions.map((p) => t(`permissions.${p.replace('.', '_')}`))
                        )}
                  </td>
                  <td className="tabular-nums">{format.number(role.memberCount)}</td>
                  <td>
                    {!role.locked && (
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="icon-btn"
                          title={t('roles.edit')}
                          aria-label={t('roles.editName', { name: roleName(role) })}
                          onClick={() => setEditing(role)}
                        >
                          <Pencil size={16} />
                        </button>
                        {role.key === null && (
                          <button
                            type="button"
                            className="icon-btn hover:text-red-700"
                            title={
                              role.memberCount > 0
                                ? t('members.errors.role_in_use')
                                : t('roles.delete')
                            }
                            aria-label={t('roles.deleteName', { name: roleName(role) })}
                            disabled={role.memberCount > 0}
                            onClick={() => remove(role)}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <RoleDialog
          role={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </section>
  )
}

export default RolesPanel
