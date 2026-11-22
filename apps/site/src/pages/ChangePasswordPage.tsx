import { useTranslation } from 'react-i18next'
import { LogOut } from 'lucide-react'
import type { AuthUser } from '@masarat/shared/auth'
import ChangePasswordForm from '../components/auth/ChangePasswordForm'
import AuthCard from './AuthCard'

function ChangePasswordPage({
  user,
  onChanged,
  onLogOut
}: {
  user: AuthUser
  onChanged: (user: AuthUser) => void
  onLogOut: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <AuthCard
      title={t(
        user.mustChangePassword ? 'auth.changePassword.title' : 'auth.changePassword.titleVoluntary'
      )}
      subtitle={user.mustChangePassword ? t('auth.changePassword.body') : undefined}
    >
      <p className="mb-4 text-sm text-stone-600">
        <bdi className="font-medium text-stone-900">{user.fullName}</bdi>{' '}
        <span dir="ltr" className="text-stone-500">
          ({user.username})
        </span>
      </p>
      <ChangePasswordForm onChanged={onChanged} />
      <div className="mt-6 border-t border-stone-200 pt-4 text-center">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onLogOut}>
          <LogOut size={16} className="rtl:-scale-x-100" />
          {t('auth.changePassword.logOut')}
        </button>
      </div>
    </AuthCard>
  )
}

export default ChangePasswordPage
