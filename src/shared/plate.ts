// Sudanese plate numbers: a state code (1-2 letters), a series from 1 to 99, then a number from
// 1 to 99999. Stored in English as "<CODE> <SERIES>/<NUMBER>" (e.g. "KH 12/34567"); the UI shows
// the Arabic form in Arabic.

export const PLATE_CODES = [
  'KH',
  'RS',
  'NK',
  'K',
  'WN',
  'SD',
  'G',
  'GD',
  'S',
  'BN',
  'WD',
  'ND',
  'RN',
  'SK',
  'N',
  'CD',
  'WK'
] as const

export type PlateCode = (typeof PLATE_CODES)[number]

// Arabic letters for each state code, as written on the plate
export const PLATE_LETTERS_AR: Record<PlateCode, string> = {
  KH: 'خ',
  RS: 'ب ح',
  NK: 'ش ك',
  K: 'ك',
  WN: 'ن ب',
  SD: 'ج د',
  G: 'ج',
  GD: 'ق',
  S: 'س',
  BN: 'ن ر',
  WD: 'غ د',
  ND: 'ش د',
  RN: 'ن',
  SK: 'ج ك',
  N: 'ش',
  CD: 'و د',
  WK: 'غ ك'
}

export const PLATE_SERIES_MAX = 99
export const PLATE_SERIES_MAX_DIGITS = 2
export const PLATE_NUMBER_MAX = 99999
export const PLATE_NUMBER_MAX_DIGITS = 5

export interface PlateParts {
  code: PlateCode
  series: number
  number: number
}

const isPlateCode = (value: string): value is PlateCode =>
  (PLATE_CODES as readonly string[]).includes(value)

const inRange = (value: number, max: number): boolean => value >= 1 && value <= max

export function formatPlate({ code, series, number }: PlateParts): string {
  return `${code} ${series}/${number}`
}

// Accepts the stored form; returns null for anything that isn't a valid plate
export function parsePlate(value: string): PlateParts | null {
  const match = /^([A-Z]{1,2}) (\d{1,2})\/(\d{1,5})$/.exec(value.trim().toUpperCase())
  if (!match || !isPlateCode(match[1])) return null
  const series = Number(match[2])
  const number = Number(match[3])
  if (!inRange(series, PLATE_SERIES_MAX) || !inRange(number, PLATE_NUMBER_MAX)) return null
  return { code: match[1], series, number }
}

// Canonical stored form (no leading zeros, single space), or null if invalid
export function normalizePlate(value: string): string | null {
  const parts = parsePlate(value)
  return parts ? formatPlate(parts) : null
}
