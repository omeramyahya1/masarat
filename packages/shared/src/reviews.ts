// Government review of issued clearances. Any government user with govt.reports.create may report
// a trip whose receipt and manifest were issued (certified) when something looks wrong; a
// supervisor (govt.reports.review) then dismisses the report or revokes the clearance. A
// supervisor may also cancel a trip whose bill isn't paid yet. Revoking and cancelling are final
// and kept as the trip's decision (who, when, why); the company sees the outcome and the
// supervisor's note, never the reports themselves.
import type { TripRecord } from './fleet'

// Why a trip is reported (and why its clearance is revoked or the trip cancelled)
export const REPORT_REASONS = [
  // A supporting document (invoice, packing list, certificate, authorization) looks forged
  'forged_document',
  // What the vehicle carries doesn't match the manifest
  'cargo_mismatch',
  // The vehicle, plate or trailers aren't the ones on the manifest
  'wrong_vehicle',
  // The people on the bus don't match the passenger manifest
  'passenger_mismatch',
  'other'
] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

// open: waiting for a supervisor. revoked: the supervisor revoked the clearance. dismissed: the
// supervisor found nothing wrong.
export const REPORT_STATUSES = ['open', 'revoked', 'dismissed'] as const
export type ReportStatus = (typeof REPORT_STATUSES)[number]

// What a supervisor decided about a trip: its issued clearance revoked, or its unpaid trip
// cancelled. A trip has at most one decision.
export const DECISION_ACTIONS = ['revoke', 'cancel'] as const
export type DecisionAction = (typeof DECISION_ACTIONS)[number]

// Notes on reports and decisions
export const MAX_REVIEW_NOTE_LENGTH = 500

export interface ReportInput {
  manifestId: number
  reason: ReportReason
  note: string
}

// Dismissing a report: why nothing is wrong
export interface DismissInput {
  note: string
}

// Revoking the clearance a report is about, or cancelling an unpaid trip: the reason (a revoke
// keeps the report's unless another is given) and a note the company will see
export interface DecisionInput {
  reason?: ReportReason
  note: string
}

export interface CancelTripInput {
  reason: ReportReason
  note: string
}

// A report as the government sees it
export interface ReportRecord {
  id: number
  manifestId: number
  status: ReportStatus
  reason: ReportReason
  note: string
  reportedBy: string
  reportedAt: number
  // Set once a supervisor dismissed it or revoked the clearance
  resolvedBy: string | null
  resolvedAt: number | null
  resolutionNote: string | null
}

// A row of the Reports section
export interface ReportListRow extends ReportRecord {
  manifestNo: string | null
  companyName: string
  plateNumber: string
  originCityId: number
  destinationCityId: number
  departureAt: number
  tripStatus: TripRecord['status']
}

export interface ReportListQuery {
  status?: ReportStatus
  // 1-based; 50 per page unless 25 or 100 is asked for
  page?: number
  pageSize?: number
}

// The supervisor's decision on a trip, as both portals show it. `decidedBy` is only sent to the
// government; the company sees the reason and the note.
export interface TripDecision {
  action: DecisionAction
  reason: ReportReason
  note: string
  decidedAt: number
  decidedBy: string | null
}

export const isReportReason = (value: unknown): value is ReportReason =>
  REPORT_REASONS.includes(value as ReportReason)

// A note's text as stored: trimmed, and non-empty and within the limit, or null
export function cleanNote(value: unknown): string | null {
  const note = typeof value === 'string' ? value.trim() : ''
  return note.length > 0 && note.length <= MAX_REVIEW_NOTE_LENGTH ? note : null
}
