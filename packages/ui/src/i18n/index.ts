import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ar from './locales/ar.json'

export const LANGUAGES = ['en', 'ar'] as const
export type Language = (typeof LANGUAGES)[number]

const DEFAULT_LANGUAGE: Language = 'en'
const RTL_LANGUAGES: readonly Language[] = ['ar']
const STORAGE_KEY = 'masarat.language'

const isLanguage = (value: unknown): value is Language => LANGUAGES.includes(value as Language)

// The user's last choice, remembered across launches (storage can be unavailable, so never throw)
function storedLanguage(): Language {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return isLanguage(value) ? value : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

// Keep <html lang/dir> and the window title in sync so Arabic renders right-to-left
function syncDocument(lng: string): void {
  document.documentElement.lang = lng
  document.documentElement.dir = RTL_LANGUAGES.includes(lng as Language) ? 'rtl' : 'ltr'
  document.title = i18n.t('app.windowTitle')
  try {
    localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    // Not persisting the choice is harmless
  }
}

i18n.on('languageChanged', syncDocument)

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar }
  },
  lng: storedLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: LANGUAGES,
  interpolation: {
    // React already escapes rendered values
    escapeValue: false
  }
})

export default i18n
