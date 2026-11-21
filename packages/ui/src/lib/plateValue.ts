import {
  PLATE_NUMBER_MAX,
  PLATE_SERIES_MAX,
  formatPlate,
  type PlateCode
} from '@masarat/shared/plate'

// Plate as edited in the form, before it's turned into the stored English form
export interface PlateValue {
  code: PlateCode | ''
  // Western digits, as typed
  series: string
  number: string
}

const inRange = (value: number, max: number): boolean => value >= 1 && value <= max

// Stored English form, or null until every part is filled in with a valid value
export function plateValueToString({ code, series, number }: PlateValue): string | null {
  if (!code || series === '' || number === '') return null
  const parts = { code, series: Number(series), number: Number(number) }
  if (!inRange(parts.series, PLATE_SERIES_MAX) || !inRange(parts.number, PLATE_NUMBER_MAX)) {
    return null
  }
  return formatPlate(parts)
}
