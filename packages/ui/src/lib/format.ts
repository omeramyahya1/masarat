import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { CityRecord, ItemUnit, QuantityUnit } from '@masarat/shared/fleet'
import { MAX_TAX_BPS, type TaxLine } from '@masarat/shared/tax'
import { PLATE_LETTERS_AR, formatPlate, parsePlate } from '@masarat/shared/plate'

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹'

// Eastern Arabic digits, used only for plates in Arabic; the decimal point becomes the Arabic separator
export const toArabicDigits = (value: string): string =>
  value.replace(/[0-9]/g, (d) => ARABIC_DIGITS[Number(d)]).replace(/\./g, '٫')

// Inverse of toArabicDigits, so users can type with either keyboard (stored values stay Western)
export const toWesternDigits = (value: string): string =>
  value
    .replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)))
    .replace(/٫/g, '.')

// Today's local date as YYYY-MM-DD (the trip date format)
export function todayIso(): string {
  const now = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export interface Formatters {
  isArabic: boolean
  number: (value: number) => string
  currency: (amount: number) => string
  // Short forms for large figures: "29.1B SDG" / "29.1 مليار ج.س"
  compactNumber: (value: number) => string
  compactCurrency: (amount: number) => string
  // 0..1 as a percentage
  percent: (ratio: number) => string
  // A tax percentage stored in basis points: 1700 -> "17%", 1250 -> "12.5%"
  taxRate: (bps: number) => string
  // A bill line's label: "VAT (17%)", or just the name for a fixed fee
  taxLine: (line: Pick<TaxLine, 'code' | 'rateBps'>) => string
  quantity: (value: number, unit: QuantityUnit | ItemUnit) => string
  // An attachment's size: "240 KB", "3.5 MB"
  fileSize: (bytes: number) => string
  // "A, B and C" / "أ وب وج"
  list: (values: string[]) => string
  date: (ms: number) => string
  dateTime: (ms: number) => string
  // Stored English plate ("KH 12/34567") in the current language ("خ ١٢ / ٣٤٥٦٧" in Arabic)
  plate: (plate: string) => string
  city: (city: Pick<CityRecord, 'name' | 'nameAr'> | undefined) => string
}

// Formatters for a given language; the certificate always uses Arabic whatever the UI language
export function createFormatters(isArabic: boolean, t: TFunction): Formatters {
  // Numbers and dates use Western digits in both languages; only plates use Arabic digits
  const locale = isArabic ? 'ar-SD-u-nu-latn' : 'en-US'
  const numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const dateTimeFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
  const compactFormat = new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1
  })
  const percentFormat = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 1
  })
  const taxRateFormat = new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 2
  })
  const listFormat = new Intl.ListFormat(locale, { type: 'conjunction' })
  const number = (value: number): string => numberFormat.format(value)
  const compactNumber = (value: number): string => compactFormat.format(value)

  return {
    isArabic,
    number,
    currency: (amount) => t('common.currency', { amount: number(amount) }),
    compactNumber,
    compactCurrency: (amount) => t('common.currency', { amount: compactNumber(amount) }),
    percent: (ratio) => percentFormat.format(ratio),
    taxRate: (bps) => taxRateFormat.format(bps / MAX_TAX_BPS),
    taxLine: ({ code, rateBps }) =>
      rateBps === null
        ? t(`taxes.${code}`)
        : t('trips.tax.line', {
            name: t(`taxes.${code}`),
            rate: taxRateFormat.format(rateBps / MAX_TAX_BPS)
          }),
    list: (values) => listFormat.format(values),
    quantity: (value, unit) => t(`units.short.${unit}`, { value: number(value) }),
    fileSize: (bytes) =>
      bytes < 1024 * 1024
        ? t('units.kb', { value: number(Math.max(1, Math.round(bytes / 1024))) })
        : t('units.mb', { value: number(Math.round((bytes / (1024 * 1024)) * 10) / 10) }),
    date: (ms) => dateFormat.format(ms),
    dateTime: (ms) => dateTimeFormat.format(ms),
    plate: (plate) => {
      const parts = parsePlate(plate)
      if (!parts) return plate
      if (!isArabic) return formatPlate(parts)
      // Spaces around the slash keep "letters, series, number" in right-to-left order;
      // without them the bidi algorithm reads "١٢/٣٤٥٦٧" as one left-to-right number
      const { code, series, number } = parts
      return `${PLATE_LETTERS_AR[code]} ${toArabicDigits(String(series))} / ${toArabicDigits(String(number))}`
    },
    city: (city) => (city ? (isArabic && city.nameAr) || city.name : '—')
  }
}

export function useFormat(): Formatters {
  const { t, i18n } = useTranslation()
  const isArabic = i18n.language === 'ar'
  return useMemo(() => createFormatters(isArabic, t), [isArabic, t])
}
