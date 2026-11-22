import { useTranslation } from 'react-i18next'
import type { BranchRecord, RoleRecord } from '@masarat/shared/members'
import { useRoleName } from '../../lib/account'
import { SelectField } from '../form/fields'

// The role, and for a branch role (a company's clerk) the branch, of a new or changed account
function RoleFields({
  roles,
  branches,
  roleId,
  branchId,
  onChange
}: {
  roles: readonly RoleRecord[]
  // The company's branches; null on the government's side
  branches: readonly BranchRecord[] | null
  roleId: string
  branchId: string
  onChange: (value: { roleId: string; branchId: string }) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const roleName = useRoleName()
  const role = roles.find((r) => String(r.id) === roleId)
  const needsBranch = role?.scope === 'branch' && branches !== null

  return (
    <>
      <SelectField
        label={t('members.form.role')}
        placeholder={t('members.form.rolePlaceholder')}
        value={roleId}
        options={roles.map((r) => ({ value: String(r.id), label: roleName(r) }))}
        hint={role ? t(`members.scopes.${role.scope}`) : undefined}
        onChange={(e) => onChange({ roleId: e.target.value, branchId })}
      />
      {needsBranch && (
        <SelectField
          label={t('members.form.branch')}
          placeholder={t('members.form.branchPlaceholder')}
          value={branchId}
          options={branches
            .filter((b) => b.active)
            .map((b) => ({ value: String(b.id), label: b.name }))}
          onChange={(e) => onChange({ roleId, branchId: e.target.value })}
        />
      )}
    </>
  )
}

export default RoleFields
