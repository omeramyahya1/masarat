import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ar from './locales/ar.json'

export const LANGUAGES = ['en', 'ar'] as const
export type Language = (typeof LANGUAGES)[number]

const DEFAULT_LANGUAGE: Language = 'ar'
// Shown for a key missing from the current language
const FALLBACK_LANGUAGE: Language = 'en'
const RTL_LANGUAGES: readonly Language[] = ['ar']

// The choice is a cookie so the three sites share it: on COOKIE_DOMAIN (`.masarat.com`) in
// production, and host-only on localhost (shared across ports) in development
const COOKIE_NAME = 'masarat_lang'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365
const COOKIE_DOMAIN = import.meta.env.VITE_COOKIE_DOMAIN

const isLanguage = (value: unknown): value is Language => LANGUAGES.includes(value as Language)

// The user's last choice (cookies can be unavailable, so never throw)
function storedLanguage(): Language {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_NAME}=([^;]*)`))
    const value = match?.[1]
    return isLanguage(value) ? value : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

function storeLanguage(lng: string): void {
  const domain = COOKIE_DOMAIN ? `; Domain=${COOKIE_DOMAIN}` : ''
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  try {
    document.cookie = `${COOKIE_NAME}=${lng}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${domain}${secure}`
  } catch {
    // Not persisting the choice is harmless
  }
}

// Keep <html lang/dir> and the window title in sync so Arabic renders right-to-left
function syncDocument(lng: string): void {
  document.documentElement.lang = lng
  document.documentElement.dir = RTL_LANGUAGES.includes(lng as Language) ? 'rtl' : 'ltr'
  document.title = i18n.t('app.windowTitle')
  storeLanguage(lng)
}

i18n.on('languageChanged', syncDocument)

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ar: { translation: ar }
  },
  lng: storedLanguage(),
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: LANGUAGES,
  interpolation: {
    // React already escapes rendered values
    escapeValue: false
  }
})

export default i18n
