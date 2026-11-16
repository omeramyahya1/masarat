import { useTranslation } from 'react-i18next'
import { Languages } from 'lucide-react'

// Shows the name of the other language, written in that language (e.g. "العربية" while in English)
function LanguageToggle(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const target = i18n.language === 'ar' ? 'en' : 'ar'

  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      title={t('language.label')}
      onClick={() => i18n.changeLanguage(target)}
    >
      <Languages size={16} />
      <span lang={target}>{t('language.switchTo')}</span>
    </button>
  )
}

export default LanguageToggle
