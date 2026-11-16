import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ar from './locales/ar.json'

export const LANGUAGES = ['en', 'ar'] as const
export type Language = (typeof LANGUAGES)[number]

const RTL_LANGUAGES: readonly Language[] = ['ar']

// Keep <html lang/dir> in sync so Arabic renders right-to-left
function applyDocumentDirection(lng: string): void {
  document.documentElement.lang = lng
  document.documentElement.dir = RTL_LANGUAGES.includes(lng as Language) ? 'rtl' : 'ltr'
}

i18n.on('languageChanged', applyDocumentDirection)

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar }
  },
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: LANGUAGES,
  interpolation: {
    // React already escapes rendered values
    escapeValue: false
  }
})

export default i18n
