import { PLATE_NUMBER_MAX, formatPlate, type PlateCode } from '../../../shared/plate'

// Plate as edited in the form, before it's turned into the stored English form
export interface PlateValue {
  code: PlateCode | ''
  // Western digits, as typed
  number: string
}

// Stored English form, or null until both parts are filled in
export function plateValueToString({ code, number }: PlateValue): string | null {
  if (!code || number === '') return null
  const parsed = Number(number)
  return parsed <= PLATE_NUMBER_MAX ? formatPlate({ code, number: parsed }) : null
}
