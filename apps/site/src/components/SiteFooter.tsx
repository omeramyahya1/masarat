import { useTranslation } from 'react-i18next'

function SiteFooter(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <footer className="border-t border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-xs text-stone-500 sm:flex-row sm:justify-between sm:px-6">
        <span>{t('site.footer.tagline')}</span>
        <span>{t('site.footer.rights', { year: new Date().getFullYear() })}</span>
      </div>
    </footer>
  )
}

export default SiteFooter
