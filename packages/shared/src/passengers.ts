// A passenger trip's passengers (a bus). Each passenger with a seat has a ticket; an infant on a
// parent's lap shares their seat, has no ticket and may have no ID. After the bill is issued the
// list can't change (no late boarding on this system).

export const ID_TYPES = ['national_id', 'passport'] as const
export type IdType = (typeof ID_TYPES)[number]

export const MAX_PASSENGER_NAME_LENGTH = 120
export const MAX_PASSENGER_NOTES_LENGTH = 200
// Rows on one trip, infants included
export const MAX_PASSENGERS = 200

export interface PassengerInput {
  fullName: string
  // Null only for an infant without an ID, or on a draft that hasn't recorded it yet
  idType: IdType | null
  idNumber: string | null
  // From 1 to the bus's seats; an infant takes the seat of the passenger they travel with
  seatNo: number
  isInfant: boolean
  // Free text: nationality, "رضيع", …
  notes: string | null
}

export type PassengerRecord = PassengerInput

const toWesternDigits = (value: string): string =>
  value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))

// A Sudanese national ID is 11 digits; a passport 6 to 20 letters and digits. Stored without
// spaces or dashes, letters upper-case, digits Western. Null if it isn't valid for the type.
export function normalizeIdNumber(type: IdType, value: string): string | null {
  const compact = toWesternDigits(value).replace(/[\s-]/g, '').toUpperCase()
  if (type === 'national_id') return /^[0-9]{11}$/.test(compact) ? compact : null
  return /^[A-Z0-9]{6,20}$/.test(compact) ? compact : null
}

// What a search box query is as an ID number, if it could be one (for the exact match the
// government search does)
export function idSearchKey(query: string): string | null {
  return (
    normalizeIdNumber('national_id', query) ??
    (/[0-9]/.test(query) ? normalizeIdNumber('passport', query) : null)
  )
}

// The tickets sold: everyone who has a seat
export const ticketCount = (passengers: readonly Pick<PassengerInput, 'isInfant'>[]): number =>
  passengers.filter((p) => !p.isInfant).length

export type PassengersError = 'invalid_passengers' | 'seat_taken' | 'over_capacity'

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

// Checks and normalizes a trip's passengers for a bus with this many seats. A draft may leave IDs
// out (missingForBilling asks for them before the bill); an ID that is given has to be valid.
export function checkPassengers(
  value: unknown,
  seats: number
): { ok: true; passengers: PassengerRecord[] } | { ok: false; error: PassengersError } {
  if (value === undefined) return { ok: true, passengers: [] }
  if (!Array.isArray(value) || value.length > MAX_PASSENGERS) {
    return { ok: false, error: 'invalid_passengers' }
  }
  const passengers: PassengerRecord[] = []
  for (const raw of value) {
    const fullName = asText(raw?.fullName)
    const notes = asText(raw?.notes)
    const seatNo = Number(raw?.seatNo)
    const isInfant = raw?.isInfant === true
    if (!fullName || fullName.length > MAX_PASSENGER_NAME_LENGTH) {
      return { ok: false, error: 'invalid_passengers' }
    }
    if (notes.length > MAX_PASSENGER_NOTES_LENGTH) return { ok: false, error: 'invalid_passengers' }
    if (!Number.isInteger(seatNo) || seatNo < 1 || seatNo > seats) {
      return { ok: false, error: 'invalid_passengers' }
    }
    const rawId = asText(raw?.idNumber)
    let idType: IdType | null = null
    let idNumber: string | null = null
    if (rawId) {
      if (!ID_TYPES.includes(raw?.idType)) return { ok: false, error: 'invalid_passengers' }
      idType = raw.idType as IdType
      idNumber = normalizeIdNumber(idType, rawId)
      if (!idNumber) return { ok: false, error: 'invalid_passengers' }
    }
    passengers.push({ fullName, idType, idNumber, seatNo, isInfant, notes: notes || null })
  }
  const seated = passengers.filter((p) => !p.isInfant)
  if (seated.length > seats) return { ok: false, error: 'over_capacity' }
  const taken = new Set<number>()
  for (const p of seated) {
    if (taken.has(p.seatNo)) return { ok: false, error: 'seat_taken' }
    taken.add(p.seatNo)
  }
  // An infant travels on the lap of a passenger who has a seat
  if (passengers.some((p) => p.isInfant && !taken.has(p.seatNo))) {
    return { ok: false, error: 'invalid_passengers' }
  }
  return { ok: true, passengers }
}
