import { useTranslation } from 'react-i18next'
import { PLATE_LETTERS_AR, parsePlate } from '../../../../shared/plate'
import { toArabicDigits } from '../../lib/format'

// A stored plate ("KH 123") drawn like a number plate, in the current language
function PlateBadge({ plate }: { plate: string }): React.JSX.Element {
  const { i18n } = useTranslation()
  const isArabic = i18n.language === 'ar'
  const parts = parsePlate(plate)

  if (!parts) return <span className="font-medium">{plate}</span>

  const letters = isArabic ? PLATE_LETTERS_AR[parts.code] : parts.code
  const number = isArabic ? toArabicDigits(String(parts.number)) : String(parts.number)

  return (
    <span
      className="inline-flex items-stretch overflow-hidden rounded-md border-2 border-stone-800 bg-white text-sm leading-none font-semibold text-stone-900 shadow-sm"
      dir={isArabic ? 'rtl' : 'ltr'}
    >
      <span className="flex items-center bg-brand-700 px-2 py-1 text-white">{letters}</span>
      <span className="flex items-center px-2.5 py-1 tabular-nums">{number}</span>
    </span>
  )
}

export default PlateBadge
