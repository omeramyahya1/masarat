import { useTranslation } from 'react-i18next'
import { BrandMark } from '@masarat/ui/components/BrandMark'
import LanguageToggle from '@masarat/ui/components/LanguageToggle'
import type { Page } from '../router'
import Link from './Link'

function SiteHeader({
  page,
  navigate
}: {
  page: Page
  navigate: (page: Page) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <header className="sticky top-0 z-10 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link to="landing" navigate={navigate} className="flex items-center gap-3 rounded-lg">
          <BrandMark />
          <span className="leading-tight">
            <span className="block text-base font-semibold text-stone-900">{t('app.name')}</span>
            <span className="hidden text-xs text-stone-500 sm:block">{t('app.tagline')}</span>
          </span>
        </Link>
        <nav className="flex items-center gap-2">
          <LanguageToggle />
          {page !== 'login' && (
            <Link to="login" navigate={navigate} className="btn btn-secondary btn-sm">
              {t('site.nav.login')}
            </Link>
          )}
          {page !== 'signup' && (
            <Link to="signup" navigate={navigate} className="btn btn-primary btn-sm max-sm:hidden">
              {t('site.nav.signup')}
            </Link>
          )}
        </nav>
      </div>
    </header>
  )
}

export default SiteHeader
