import { useTranslation } from 'react-i18next'
import { LogOut, UserRound } from 'lucide-react'
import type { AuthUser } from '../../../shared/auth'
import OwnerWorkspace from './OwnerWorkspace'

interface HomeViewProps {
  user: AuthUser
  onLogOut: () => void
}

function HomeView({ user, onLogOut }: HomeViewProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-stone-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-full bg-brand-50 text-brand-700">
            <UserRound size={18} />
          </div>
          <div className="leading-tight">
            <div className="font-medium text-stone-900">{user.fullName}</div>
            <div className="text-xs text-stone-500">
              {t(`panels.${user.role}.title`)} · {user.username}
            </div>
          </div>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onLogOut}>
          <LogOut size={16} className="rtl:-scale-x-100" />
          {t('home.logOut')}
        </button>
      </div>

      {user.role === 'owner' ? (
        <OwnerWorkspace />
      ) : (
        <div className="flex flex-1 items-center justify-center p-8">
          <h1 className="text-2xl font-semibold text-stone-900">{t('home.welcome')}</h1>
        </div>
      )}
    </div>
  )
}

export default HomeView
