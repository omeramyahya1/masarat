// Passenger rows as the trip form edits them
import type { IdType, PassengerRecord } from '@masarat/shared/passengers'

// A passenger row as typed; the seat stays a string until the form is submitted
export interface PassengerDraft {
  key: number
  fullName: string
  idType: IdType
  idNumber: string
  seatNo: string
  isInfant: boolean
  notes: string
}

let nextKey = 0
export const newPassengerDraft = (passenger?: PassengerRecord, seatNo = ''): PassengerDraft => ({
  key: nextKey++,
  fullName: passenger?.fullName ?? '',
  idType: passenger?.idType ?? 'national_id',
  idNumber: passenger?.idNumber ?? '',
  seatNo: passenger ? String(passenger.seatNo) : seatNo,
  isInfant: passenger?.isInfant ?? false,
  notes: passenger?.notes ?? ''
})

// Infants on a seat nobody with a ticket has
export function orphanInfants(passengers: readonly PassengerDraft[]): Set<number> {
  const seats = new Set(passengers.filter((p) => !p.isInfant).map((p) => p.seatNo))
  return new Set(passengers.filter((p) => p.isInfant && !seats.has(p.seatNo)).map((p) => p.key))
}

// Seats taken by more than one passenger (infants share their parent's seat)
export function seatConflicts(passengers: readonly PassengerDraft[]): Set<string> {
  const seen = new Set<string>()
  const conflicts = new Set<string>()
  for (const p of passengers) {
    if (p.isInfant || !p.seatNo) continue
    if (seen.has(p.seatNo)) conflicts.add(p.seatNo)
    seen.add(p.seatNo)
  }
  return conflicts
}
