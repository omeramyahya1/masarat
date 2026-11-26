// The government's review of issued clearances (packages/shared/src/reviews.ts): a government user
// reports a certified trip, and a supervisor dismisses the report or revokes the clearance; a
// supervisor may also cancel a trip whose bill isn't paid yet. The routes check the permissions
// (govt.reports.create, govt.reports.review); these functions check the rest.
//
// The trip's status carries the outcome (revoked, cancelled), so every read that shows a trip shows
// it, archived or not; trip_decisions keeps who, when and why, and trip_reports the reports. Both
// point to the trip by id without a foreign key, so the archive can move the trip (it keeps a trip
// with an open report live until a supervisor decides).
import { and, count, desc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  archive,
  companies,
  getDb,
  isUniqueViolation,
  manifests,
  payments,
  tripDecisions,
  tripReports,
  tripViews,
  users,
  vehicles,
  type TripReport
} from '../db'
import type { FleetResult, ManifestStatus } from '@masarat/shared/fleet'
import { DEFAULT_PAGE_SIZE, isPageSize, type Page } from '@masarat/shared/paging'
import {
  cleanNote,
  isReportReason,
  type CancelTripInput,
  type DecisionInput,
  type DismissInput,
  type ReportInput,
  type ReportListQuery,
  type ReportListRow,
  type ReportRecord,
  type TripDecision
} from '@masarat/shared/reviews'
import type { Tx } from './companies'

const reporter = alias(users, 'reporter')
const resolver = alias(users, 'resolver')
const decider = alias(users, 'decider')

const reportColumns = {
  report: tripReports,
  reportedBy: reporter.fullName,
  resolvedBy: resolver.fullName
}

const toReportRecord = (row: {
  report: TripReport
  reportedBy: string
  resolvedBy: string | null
}): ReportRecord => ({
  id: row.report.id,
  manifestId: row.report.manifestId,
  status: row.report.status,
  reason: row.report.reason,
  note: row.report.note,
  reportedBy: row.reportedBy,
  reportedAt: row.report.createdAt.getTime(),
  resolvedBy: row.resolvedBy,
  resolvedAt: row.report.resolvedAt?.getTime() ?? null,
  resolutionNote: row.report.resolutionNote
})

// A trip's reports, newest first
async function reportsOf(manifestId: number): Promise<ReportRecord[]> {
  const rows = await getDb()
    .select(reportColumns)
    .from(tripReports)
    .innerJoin(reporter, eq(tripReports.reportedBy, reporter.id))
    .leftJoin(resolver, eq(tripReports.resolvedBy, resolver.id))
    .where(eq(tripReports.manifestId, manifestId))
    .orderBy(desc(tripReports.createdAt), desc(tripReports.id))
  return rows.map(toReportRecord)
}

// What the trip page shows of the review: the decision (both sides; the company doesn't learn who
// decided) and, for the government only, the reports
export async function reviewOf(
  manifestId: number,
  govt: boolean
): Promise<{ decision: TripDecision | null; reports: ReportRecord[] }> {
  const [decision] = await getDb()
    .select({ decision: tripDecisions, decidedBy: decider.fullName })
    .from(tripDecisions)
    .innerJoin(decider, eq(tripDecisions.decidedBy, decider.id))
    .where(eq(tripDecisions.manifestId, manifestId))
    .limit(1)
  return {
    decision: decision
      ? {
          action: decision.decision.action,
          reason: decision.decision.reason,
          note: decision.decision.note,
          decidedAt: decision.decision.createdAt.getTime(),
          decidedBy: govt ? decision.decidedBy : null
        }
      : null,
    reports: govt ? await reportsOf(manifestId) : []
  }
}

// The live trip's status, locked for the rest of the transaction
async function lockLiveTrip(tx: Tx, manifestId: number): Promise<ManifestStatus | null> {
  const [trip] = await tx
    .select({ status: manifests.status })
    .from(manifests)
    .where(eq(manifests.id, manifestId))
    .for('update')
  return trip?.status ?? null
}

// Files a report on a certified trip. One open report per trip: a second one is refused
// (report_open) while a supervisor reviews the first. An archived trip is read-only, like
// everywhere else, and answers manifest_not_found.
export async function reportTrip(
  userId: number,
  input: ReportInput
): Promise<FleetResult<{ manifestId: number }>> {
  const note = cleanNote(input.note)
  if (!note || !isReportReason(input.reason)) return { ok: false, error: 'invalid_review' }
  try {
    return await getDb().transaction(async (tx) => {
      // The trip stays locked until the report is written: a second report, the archive job or a
      // revoke waits for it
      const status = await lockLiveTrip(tx, input.manifestId)
      if (status === null) return { ok: false, error: 'manifest_not_found' }
      if (status !== 'certified') return { ok: false, error: 'not_certified' }
      const [open] = await tx
        .select({ id: tripReports.id })
        .from(tripReports)
        .where(and(eq(tripReports.manifestId, input.manifestId), eq(tripReports.status, 'open')))
        .limit(1)
      if (open) return { ok: false, error: 'report_open' }
      await tx
        .insert(tripReports)
        .values({ manifestId: input.manifestId, reason: input.reason, note, reportedBy: userId })
      return { ok: true, data: { manifestId: input.manifestId } }
    })
  } catch (error) {
    // The unique index is the backstop for two reports at once
    if (isUniqueViolation(error, 'trip_reports_one_open_idx')) {
      return { ok: false, error: 'report_open' }
    }
    throw error
  }
}

// The open report, locked, or why it can't be decided
async function lockOpenReport(
  tx: Tx,
  reportId: number
): Promise<
  { ok: true; report: TripReport } | { ok: false; error: 'report_not_found' | 'report_closed' }
> {
  const [report] = await tx
    .select()
    .from(tripReports)
    .where(eq(tripReports.id, reportId))
    .for('update')
  if (!report) return { ok: false, error: 'report_not_found' }
  if (report.status !== 'open') return { ok: false, error: 'report_closed' }
  return { ok: true, report }
}

// The supervisor found nothing wrong: the report closes, the clearance stays as it was
export async function dismissReport(
  userId: number,
  reportId: number,
  input: DismissInput
): Promise<FleetResult<{ manifestId: number }>> {
  const note = cleanNote(input.note)
  if (!note) return { ok: false, error: 'invalid_review' }
  return getDb().transaction(async (tx) => {
    const found = await lockOpenReport(tx, reportId)
    if (!found.ok) return found
    await tx
      .update(tripReports)
      .set({
        status: 'dismissed',
        resolvedBy: userId,
        resolvedAt: new Date(),
        resolutionNote: note
      })
      .where(eq(tripReports.id, reportId))
    return { ok: true, data: { manifestId: found.report.manifestId } }
  })
}

// Revokes the clearance a report is about: the trip becomes revoked (the verify page then says so),
// the decision is kept with the supervisor's reason and note, and the report closes as revoked
export async function revokeReport(
  userId: number,
  reportId: number,
  input: DecisionInput
): Promise<FleetResult<{ manifestId: number }>> {
  const note = cleanNote(input.note)
  if (!note || (input.reason !== undefined && !isReportReason(input.reason))) {
    return { ok: false, error: 'invalid_review' }
  }
  return getDb().transaction(async (tx) => {
    const found = await lockOpenReport(tx, reportId)
    if (!found.ok) return found
    const { report } = found
    // The trip is live: the archive job leaves a trip with an open report alone. If it was moved
    // anyway (a report filed while the job was choosing its batch), it's revoked where it is.
    let table: typeof manifests | typeof archive.manifests = manifests
    let status = await lockLiveTrip(tx, report.manifestId)
    if (status === null) {
      table = archive.manifests
      const [archived] = await tx
        .select({ status: archive.manifests.status })
        .from(archive.manifests)
        .where(eq(archive.manifests.id, report.manifestId))
        .for('update')
      status = archived?.status ?? null
    }
    if (status === null) return { ok: false, error: 'manifest_not_found' }
    if (status !== 'certified') return { ok: false, error: 'not_certified' }

    const now = new Date()
    await tx.update(table).set({ status: 'revoked' }).where(eq(table.id, report.manifestId))
    await tx.insert(tripDecisions).values({
      manifestId: report.manifestId,
      action: 'revoke',
      reason: input.reason ?? report.reason,
      note,
      reportId,
      decidedBy: userId,
      createdAt: now
    })
    await tx
      .update(tripReports)
      .set({ status: 'revoked', resolvedBy: userId, resolvedAt: now, resolutionNote: note })
      .where(eq(tripReports.id, reportId))
    return { ok: true, data: { manifestId: report.manifestId } }
  })
}

// Cancels a trip whose bill isn't paid yet: the trip and its bill become cancelled, so it can't be
// paid or authorized any more (refreshBillStatus refuses it, even if E-Sali later reports the bill
// paid). Billed trips are never archived, so it's always a live one.
export async function cancelTrip(
  userId: number,
  manifestId: number,
  input: CancelTripInput
): Promise<FleetResult<{ manifestId: number }>> {
  const note = cleanNote(input.note)
  if (!note || !isReportReason(input.reason)) return { ok: false, error: 'invalid_review' }
  return getDb().transaction(async (tx) => {
    // The trip first, then its bill: refreshBillStatus takes the locks in the same order, so a
    // payment recorded at the same moment either comes first (and this refuses) or waits and finds
    // the trip cancelled
    const status = await lockLiveTrip(tx, manifestId)
    if (status === null) return { ok: false, error: 'manifest_not_found' }
    if (status !== 'billed') return { ok: false, error: 'not_pending' }
    const cancelled = await tx
      .update(payments)
      .set({ status: 'cancelled' })
      .where(and(eq(payments.manifestId, manifestId), eq(payments.status, 'pending')))
      .returning({ id: payments.id })
    if (cancelled.length === 0) return { ok: false, error: 'not_pending' }
    await tx.update(manifests).set({ status: 'cancelled' }).where(eq(manifests.id, manifestId))
    await tx.insert(tripDecisions).values({
      manifestId,
      action: 'cancel',
      reason: input.reason,
      note,
      decidedBy: userId
    })
    return { ok: true, data: { manifestId } }
  })
}

// The Reports section: newest first, optionally of one status, a page at a time. The trips are read
// through the all_* views: a decided report's trip may have moved to the archive since.
export async function listReports(query: ReportListQuery): Promise<Page<ReportListRow>> {
  const { manifests: trips, certificates } = tripViews
  const pageSize = isPageSize(query.pageSize) ? query.pageSize : DEFAULT_PAGE_SIZE
  const where = query.status ? eq(tripReports.status, query.status) : undefined
  const db = getDb()
  const [[{ total }], [{ overall }]] = await Promise.all([
    db.select({ total: count() }).from(tripReports).where(where),
    db.select({ overall: count() }).from(tripReports)
  ])
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(1, Math.floor(query.page ?? 1)), pages)
  const rows = await db
    .select({
      ...reportColumns,
      manifestNo: certificates.manifestNo,
      companyName: companies.name,
      plateNumber: vehicles.plateNumber,
      originCityId: trips.originCityId,
      destinationCityId: trips.destinationCityId,
      departureAt: trips.departureAt,
      tripStatus: trips.status
    })
    .from(tripReports)
    .innerJoin(trips, eq(trips.id, tripReports.manifestId))
    .innerJoin(vehicles, eq(trips.vehicleId, vehicles.id))
    .innerJoin(companies, eq(trips.companyId, companies.id))
    .leftJoin(certificates, eq(certificates.manifestId, tripReports.manifestId))
    .innerJoin(reporter, eq(tripReports.reportedBy, reporter.id))
    .leftJoin(resolver, eq(tripReports.resolvedBy, resolver.id))
    .where(where)
    .orderBy(desc(tripReports.createdAt), desc(tripReports.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
  return {
    rows: rows.map((row) => ({
      ...toReportRecord(row),
      manifestNo: row.manifestNo,
      companyName: row.companyName,
      plateNumber: row.plateNumber,
      originCityId: row.originCityId,
      destinationCityId: row.destinationCityId,
      departureAt: row.departureAt.getTime(),
      tripStatus: row.tripStatus
    })),
    total,
    overall,
    page,
    pageSize
  }
}

// For the verify page: when the clearance was revoked, and whether a report is open on it
export async function verifyReviewOf(
  manifestId: number
): Promise<{ revokedAt: Date | null; underReview: boolean }> {
  const db = getDb()
  const [[revoked], [open]] = await Promise.all([
    db
      .select({ at: tripDecisions.createdAt })
      .from(tripDecisions)
      .where(and(eq(tripDecisions.manifestId, manifestId), eq(tripDecisions.action, 'revoke')))
      .limit(1),
    db
      .select({ one: sql<number>`1` })
      .from(tripReports)
      .where(and(eq(tripReports.manifestId, manifestId), eq(tripReports.status, 'open')))
      .limit(1)
  ])
  return { revokedAt: revoked?.at ?? null, underReview: Boolean(open) }
}
