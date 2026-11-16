// Sudanese plate numbers: a state code (1-2 letters) followed by a number from 0 to 99999.
// Stored in English as "<CODE> <NUMBER>" (e.g. "KH 12345"); the UI shows the Arabic form in Arabic.

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

export const PLATE_NUMBER_MAX = 99999
export const PLATE_NUMBER_MAX_DIGITS = 5

export interface PlateParts {
  code: PlateCode
  number: number
}

const isPlateCode = (value: string): value is PlateCode =>
  (PLATE_CODES as readonly string[]).includes(value)

export function formatPlate({ code, number }: PlateParts): string {
  return `${code} ${number}`
}

// Accepts the stored form; returns null for anything that isn't a valid plate
export function parsePlate(value: string): PlateParts | null {
  const match = /^([A-Z]{1,2}) (\d{1,5})$/.exec(value.trim().toUpperCase())
  if (!match || !isPlateCode(match[1])) return null
  const number = Number(match[2])
  return number <= PLATE_NUMBER_MAX ? { code: match[1], number } : null
}

// Canonical stored form (no leading zeros, single space), or null if invalid
export function normalizePlate(value: string): string | null {
  const parts = parsePlate(value)
  return parts ? formatPlate(parts) : null
}
