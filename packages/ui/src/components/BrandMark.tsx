import { useTranslation } from 'react-i18next'
import mark from '../assets/brand/mark.svg'
import lockup from '../assets/brand/logo-horizontal.svg'

// The Masarat logo (brand/README.md). The mark is decorative: it always sits next to the
// translated name, which is what screen readers read.
export function BrandMark({ className = 'h-8 w-auto' }: { className?: string }): React.JSX.Element {
  return <img src={mark} alt="" className={className} />
}

// The full logo: the mark, a divider and the bilingual wordmark (مسارات over MASARAT)
export function BrandLockup({
  className = 'h-16 w-auto'
}: {
  className?: string
}): React.JSX.Element {
  const { t } = useTranslation()
  return <img src={lockup} alt={t('app.name')} className={className} />
}
