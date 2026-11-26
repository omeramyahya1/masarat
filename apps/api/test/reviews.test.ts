// The government's review of issued clearances: who may report and review, one open report per
// trip, dismissing, revoking a certified trip, cancelling one whose bill is unpaid (and E-Sali
// reporting it paid afterwards), what the verify page and the company see, and archived trips.
import { beforeAll, describe, expect, test } from 'bun:test'
import { and, eq, sql } from 'drizzle-orm'
import {
  archive,
  certificates,
  dailyRevenue,
  getDb,
  manifests,
  payments,
  tripDecisions,
  tripReports
} from '../src/db'
import { archiveDueTrips } from '../src/services/archive'
import { verifyManifest } from '../src/services/verify'
import { resetData, signedIn, type Browser } from './helpers'

const DAY_MS = 86_400_000
// "YYYY-MM-DDTHH:MM", local time, `days` from now (negative: ago)
const local = (days: number): string => {
  const d = new Date(Date.now() + days * DAY_MS)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T08:00`
}

let owner: Browser
let otherOwner: Browser
let admin: Browser
let supervisor: Browser
let agent: Browser
let vehicleId = 0

async function book(departureInDays = 0): Promise<number> {
  const reference = await owner.call('GET', '/trips/reference')
  const city = Object.fromEntries(
    reference.body.data.cities.map((c: { name: string; id: number }) => [c.name, c.id])
  )
  const branches = await owner.call('GET', '/branches')
  const drivers = await owner.call('GET', '/drivers')
  const created = await owner.call('POST', '/trips', {
    branchId: branches.body.data[0].id,
    vehicleId,
    originCityId: city.Khartoum,
    destinationCityId: city['Port Sudan'],
    items: [
      {
        name: 'Cement',
        quantity: 20,
        unit: 'ton',
        cargoType: 'general_cargo',
        packingType: 'Bags',
        packageCount: 400,
        notes: null
      }
    ],
    departureAt: local(departureInDays),
    arrivalAt: local(departureInDays + 1),
    tripKind: 'domestic',
    trailers: [],
    driverId: drivers.body.data[0].id,
    shipper: { name: 'Sender Co', address: 'Khartoum', phone: '0911111111' },
    receiver: { name: 'Receiver Co', address: 'Port Sudan', phone: '0922222222' }
  })
  expect(created.status).toBe(200)
  return created.body.data.id
}

const bill = async (id: number): Promise<void> => {
  expect((await owner.call('POST', `/trips/${id}/bill`)).status).toBe(200)
}

async function certify(id: number): Promise<void> {
  await bill(id)
  expect((await owner.call('POST', `/trips/${id}/simulate-payment`)).status).toBe(200)
  expect((await owner.call('POST', `/trips/${id}/refresh`)).body.data.trip.status).toBe('certified')
}

async function certifiedTrip(departureInDays = 0): Promise<number> {
  const id = await book(departureInDays)
  await certify(id)
  return id
}

const tokenOf = async (manifestId: number): Promise<string> => {
  const [certificate] = await getDb()
    .select({ token: certificates.qrToken })
    .from(certificates)
    .where(eq(certificates.manifestId, manifestId))
  return certificate.token
}

// What the verify page gets for a token (the service: the route's per-IP limit is shared with
// verify.test.ts, which runs it out)
async function verified(token: string): Promise<Record<string, unknown>> {
  const result = await verifyManifest(token)
  if (!result.ok) throw new Error(result.error)
  return result.data as unknown as Record<string, unknown>
}

type Reply = Awaited<ReturnType<Browser['call']>>

const report = (
  b: Browser,
  manifestId: number,
  note = 'The invoice looks altered'
): Promise<Reply> =>
  b.call('POST', '/govt/reports', { manifestId, reason: 'forged_document', note })

const openReportOf = async (manifestId: number): Promise<number> => {
  const [row] = await getDb()
    .select({ id: tripReports.id })
    .from(tripReports)
    .where(and(eq(tripReports.manifestId, manifestId), eq(tripReports.status, 'open')))
  return row.id
}

beforeAll(async () => {
  await resetData()
  owner = (
    await signedIn('review.owner', 'company_admin', {
      companyName: 'Review Co',
      address: 'Khartoum',
      tin: '300777'
    })
  ).b
  otherOwner = (await signedIn('review.other', 'company_admin', { companyName: 'Other Co' })).b
  admin = (await signedIn('review.admin', 'govt_admin')).b
  supervisor = (await signedIn('review.supervisor', 'govt_supervisor')).b
  agent = (await signedIn('review.agent', 'govt_agent')).b
  vehicleId = (
    await owner.call('POST', '/vehicles', {
      plateNumber: 'KH 8/8888',
      registrationNo: 'R-8',
      vehicleType: 'heavy_duty_truck',
      capacity: 30,
      capacityUnit: 'ton'
    })
  ).body.data.id
  await owner.call('POST', '/drivers', { name: 'Ahmed Ali', phone: '0912345678' })
}, 60_000)

describe('permissions', () => {
  test('the supervisor reviews; the agent only reports; the admin does both', async () => {
    const me = async (b: Browser): Promise<string[]> =>
      (await b.call('GET', '/auth/me')).body.user.permissions
    expect(await me(supervisor)).toEqual([
      'govt.dashboard',
      'govt.search',
      'govt.exports',
      'govt.reports.create',
      'govt.reports.review'
    ])
    expect(await me(agent)).toContain('govt.reports.create')
    expect(await me(agent)).not.toContain('govt.reports.review')
    expect(await me(admin)).toEqual(
      expect.arrayContaining(['govt.users', 'govt.reports.create', 'govt.reports.review'])
    )
    // The supervisor can't manage taxes, settings or accounts
    expect((await supervisor.call('GET', '/govt/charges')).status).toBe(403)
    expect((await supervisor.call('GET', '/govt/settings')).status).toBe(403)
    expect((await supervisor.call('GET', '/govt/users')).status).toBe(403)
  })

  test('only reviewers see the reports and decide; companies are refused everything', async () => {
    const id = await certifiedTrip()
    for (const b of [agent, owner]) {
      expect((await b.call('GET', '/govt/reports')).status).toBe(403)
      expect((await b.call('POST', '/govt/reports/1/dismiss', { note: 'x' })).status).toBe(403)
      expect((await b.call('POST', '/govt/reports/1/revoke', { note: 'x' })).status).toBe(403)
      expect(
        (await b.call('POST', `/govt/trips/${id}/cancel`, { reason: 'other', note: 'x' })).status
      ).toBe(403)
    }
    expect((await report(owner, id)).status).toBe(403)
    expect((await supervisor.call('GET', '/govt/reports')).status).toBe(200)
    expect((await admin.call('GET', '/govt/reports')).status).toBe(200)
    // The supervisor opens any trip (from the Reports section) and its attachments
    expect((await supervisor.call('GET', `/govt/trips/${id}`)).status).toBe(200)
  })

  test('the admin may give the supervisor role in Users', async () => {
    const roles = (await admin.call('GET', '/govt/users/roles')).body.data as {
      id: number
      key: string
    }[]
    const supervisorRole = roles.find((r) => r.key === 'govt_supervisor')!
    const created = await admin.call('POST', '/govt/users', {
      username: 'second.supervisor',
      fullName: 'Second Supervisor',
      phone: '0915551234',
      roleId: supervisorRole.id
    })
    expect(created.status).toBe(200)
  })
})

describe('reporting', () => {
  test('any reporter reports a certified trip; the report shows on the government view', async () => {
    const id = await certifiedTrip()
    const result = await report(agent, id)
    expect(result.status).toBe(200)
    expect(result.body.data.trip.status).toBe('certified')
    expect(result.body.data.reports).toMatchObject([
      {
        manifestId: id,
        status: 'open',
        reason: 'forged_document',
        note: 'The invoice looks altered',
        reportedBy: 'review.agent',
        resolvedAt: null
      }
    ])
    expect(result.body.data.decision).toBeNull()
  })

  test('only an issued clearance can be reported', async () => {
    const draft = await book()
    expect((await report(agent, draft)).body.error).toBe('not_certified')
    await bill(draft)
    expect((await report(agent, draft)).body).toEqual({ ok: false, error: 'not_certified' })
    expect((await report(agent, 999_999)).status).toBe(404)
  })

  test('a reason and a note are required', async () => {
    const id = await certifiedTrip()
    expect((await report(agent, id, '   ')).body.error).toBe('invalid_review')
    expect((await report(agent, id, 'x'.repeat(501))).body.error).toBe('invalid_review')
    const bad = await agent.call('POST', '/govt/reports', {
      manifestId: id,
      reason: 'x',
      note: 'y'
    })
    expect(bad).toMatchObject({ status: 400, body: { error: 'invalid_request' } })
  })

  test('one open report per trip: a second one is refused until it is dismissed', async () => {
    const id = await certifiedTrip()
    expect((await report(agent, id)).status).toBe(200)
    const second = await report(supervisor, id, 'The plate looked different')
    expect(second).toMatchObject({ status: 409, body: { error: 'report_open' } })
    // Two at once: one is filed, the other refused
    const other = await certifiedTrip()
    const both = await Promise.all([report(agent, other), report(admin, other)])
    expect(both.map((r) => r.status).sort()).toEqual([200, 409])

    const reportId = await openReportOf(id)
    expect(
      (await supervisor.call('POST', `/govt/reports/${reportId}/dismiss`, { note: 'Checked' }))
        .status
    ).toBe(200)
    const again = await report(agent, id, 'Again, at another checkpoint')
    expect(again.status).toBe(200)
    expect(again.body.data.reports.map((r: { status: string }) => r.status)).toEqual([
      'open',
      'dismissed'
    ])
  })
})

describe('dismissing', () => {
  test('closes the report with the note; the clearance stays valid', async () => {
    const id = await certifiedTrip()
    await report(agent, id)
    const reportId = await openReportOf(id)
    expect(
      (await supervisor.call('POST', `/govt/reports/${reportId}/dismiss`, { note: '' })).body.error
    ).toBe('invalid_review')
    const result = await supervisor.call('POST', `/govt/reports/${reportId}/dismiss`, {
      note: 'The invoice matches the bank record'
    })
    expect(result.status).toBe(200)
    expect(result.body.data.trip.status).toBe('certified')
    expect(result.body.data.decision).toBeNull()
    expect(result.body.data.reports[0]).toMatchObject({
      status: 'dismissed',
      resolvedBy: 'review.supervisor',
      resolutionNote: 'The invoice matches the bank record'
    })
    // Decided once
    for (const action of ['dismiss', 'revoke']) {
      const twice = await supervisor.call('POST', `/govt/reports/${reportId}/${action}`, {
        note: 'Again'
      })
      expect(twice).toMatchObject({ status: 409, body: { error: 'report_closed' } })
    }
    expect(
      (await supervisor.call('POST', '/govt/reports/999999/dismiss', { note: 'x' })).status
    ).toBe(404)
    expect(await verified(await tokenOf(id))).toMatchObject({
      status: 'valid',
      underReview: false,
      revokedAt: null
    })
  })
})

describe('revoking', () => {
  test('the clearance becomes revoked, with who, when and why kept', async () => {
    const id = await certifiedTrip()
    await report(agent, id)
    const reportId = await openReportOf(id)
    const result = await supervisor.call('POST', `/govt/reports/${reportId}/revoke`, {
      reason: 'cargo_mismatch',
      note: 'The truck carried fuel, not cement'
    })
    expect(result.status).toBe(200)
    expect(result.body.data.trip.status).toBe('revoked')
    expect(result.body.data.decision).toMatchObject({
      action: 'revoke',
      reason: 'cargo_mismatch',
      note: 'The truck carried fuel, not cement',
      decidedBy: 'review.supervisor'
    })
    expect(result.body.data.reports[0]).toMatchObject({ status: 'revoked' })
    const [decision] = await getDb()
      .select()
      .from(tripDecisions)
      .where(eq(tripDecisions.manifestId, id))
    expect(decision).toMatchObject({ action: 'revoke', reportId })
    // The payment and the revenue it brought stay as they were
    const [payment] = await getDb().select().from(payments).where(eq(payments.manifestId, id))
    expect(payment.status).toBe('paid')
    // A revoked trip can't be reported again
    expect((await report(agent, id)).body.error).toBe('not_certified')
  })

  test('without a reason the report’s is kept', async () => {
    const id = await certifiedTrip()
    await report(agent, id)
    const result = await admin.call('POST', `/govt/reports/${await openReportOf(id)}/revoke`, {
      note: 'Forged invoice confirmed'
    })
    expect(result.body.data.decision).toMatchObject({ reason: 'forged_document' })
  })
})

describe('cancelling an unpaid trip', () => {
  test('a pending trip becomes cancelled, its bill too; others are refused', async () => {
    const draft = await book()
    const cancel = (id: number): Promise<Reply> =>
      supervisor.call('POST', `/govt/trips/${id}/cancel`, {
        reason: 'wrong_vehicle',
        note: 'Booked on a vehicle that is off the road'
      })
    expect((await cancel(draft)).body.error).toBe('not_pending')
    expect((await cancel(await certifiedTrip())).body.error).toBe('not_pending')
    expect((await cancel(999_999)).status).toBe(404)

    await bill(draft)
    const result = await cancel(draft)
    expect(result.status).toBe(200)
    expect(result.body.data.trip.status).toBe('cancelled')
    expect(result.body.data.payment.status).toBe('cancelled')
    expect(result.body.data.decision).toMatchObject({
      action: 'cancel',
      reason: 'wrong_vehicle',
      decidedBy: 'review.supervisor'
    })
    expect((await cancel(draft)).body.error).toBe('not_pending')
  })

  test('refreshBillStatus refuses it, even when E-Sali later reports the bill paid', async () => {
    const id = await book()
    await bill(id)
    await supervisor.call('POST', `/govt/trips/${id}/cancel`, { reason: 'other', note: 'Fraud' })
    const revenueBefore = await getDb().$count(dailyRevenue)
    // The company pays the bill anyway
    await getDb().execute(sql`
      update esali_sim_bills set status = 'paid', paid_at = now(), payment_ref = 'BNK000000001'
      where bill_id = (select bill_id from payments where manifest_id = ${id})`)
    const refreshed = await owner.call('POST', `/trips/${id}/refresh`)
    expect(refreshed).toMatchObject({ status: 409, body: { error: 'trip_cancelled' } })
    expect((await owner.call('POST', `/trips/${id}/simulate-payment`)).body.error).toBe(
      'trip_cancelled'
    )
    expect(await getDb().$count(certificates, eq(certificates.manifestId, id))).toBe(0)
    const [payment] = await getDb().select().from(payments).where(eq(payments.manifestId, id))
    expect(payment).toMatchObject({ status: 'cancelled', paidAt: null })
    expect(await getDb().$count(dailyRevenue)).toBe(revenueBefore)
    // Nothing to bill again either
    const page = (await owner.call('GET', `/trips/${id}`)).body.data
    expect(page.trip.status).toBe('cancelled')
  })
})

describe('the verify page', () => {
  test('an open report shows "under review", and the clearance stays valid', async () => {
    const id = await certifiedTrip()
    await report(agent, id)
    const data = await verified(await tokenOf(id))
    expect(data).toMatchObject({ status: 'valid', underReview: true, revokedAt: null })
    // Still nothing personal, and nothing of the report
    expect(JSON.stringify(data)).not.toContain('invoice')
    expect(JSON.stringify(data)).not.toContain('Sender Co')
  })

  test('a revoked clearance says so, with the date, even before it expires', async () => {
    const id = await certifiedTrip()
    await report(agent, id)
    const before = Date.now()
    await supervisor.call('POST', `/govt/reports/${await openReportOf(id)}/revoke`, {
      note: 'Forged invoice'
    })
    const data = await verified(await tokenOf(id))
    expect(data.status).toBe('revoked')
    expect(data.underReview).toBe(false)
    expect(data.revokedAt).toBeGreaterThanOrEqual(before - 1000)
    expect(data.validUntil).toBeGreaterThan(Date.now())
    expect(JSON.stringify(data)).not.toContain('Forged')
  })

  test('a cancelled trip never had a clearance: nothing is found', async () => {
    const id = await book()
    await bill(id)
    await supervisor.call('POST', `/govt/trips/${id}/cancel`, { reason: 'other', note: 'Fraud' })
    expect(await getDb().$count(certificates, eq(certificates.manifestId, id))).toBe(0)
    expect(
      await getDb().$count(archive.certificates, eq(archive.certificates.manifestId, id))
    ).toBe(0)
  })
})

describe('what the company sees', () => {
  test('never the reports; the outcome with the supervisor’s reason and note', async () => {
    const id = await certifiedTrip()
    await report(agent, id)
    const open = (await owner.call('GET', `/trips/${id}`)).body.data
    expect(open.trip.status).toBe('certified')
    expect(open.reports).toEqual([])
    expect(open.decision).toBeNull()
    expect(JSON.stringify(open)).not.toContain('The invoice looks altered')

    await supervisor.call('POST', `/govt/reports/${await openReportOf(id)}/revoke`, {
      reason: 'forged_document',
      note: 'The commercial invoice was forged'
    })
    const revoked = (await owner.call('GET', `/trips/${id}`)).body.data
    expect(revoked.trip.status).toBe('revoked')
    expect(revoked.reports).toEqual([])
    expect(revoked.decision).toMatchObject({
      action: 'revoke',
      reason: 'forged_document',
      note: 'The commercial invoice was forged',
      decidedBy: null
    })
    expect(JSON.stringify(revoked)).not.toContain('review.supervisor')
    // The trips list shows the status and filters by it
    const list = (await owner.call('GET', `/trips?status=revoked`)).body.data
    expect(list.rows.map((r: { id: number }) => r.id)).toContain(id)
    // Another company still can't open it
    expect((await otherOwner.call('GET', `/trips/${id}`)).status).toBe(404)
  })
})

describe('the Reports section', () => {
  test('newest first, by status, a page at a time', async () => {
    const all = (await supervisor.call('GET', '/govt/reports?pageSize=25')).body.data
    expect(all.total).toBeGreaterThan(5)
    expect(all.total).toBe(all.overall)
    const times = all.rows.map((r: { reportedAt: number }) => r.reportedAt)
    expect(times).toEqual([...times].sort((a, b) => b - a))
    expect(all.rows[0]).toMatchObject({
      companyName: 'Review Co',
      plateNumber: 'KH 8/8888',
      manifestNo: expect.stringMatching(/^MNF-/)
    })

    for (const status of ['open', 'revoked', 'dismissed']) {
      const page = (await supervisor.call('GET', `/govt/reports?status=${status}`)).body.data
      expect(page.total).toBeGreaterThan(0)
      expect(page.rows.every((r: { status: string }) => r.status === status)).toBe(true)
      expect(page.overall).toBe(all.total)
    }
    const revoked = (await supervisor.call('GET', '/govt/reports?status=revoked')).body.data
    expect(revoked.rows.every((r: { tripStatus: string }) => r.tripStatus === 'revoked')).toBe(true)
    // An unusable status shows them all
    expect((await supervisor.call('GET', '/govt/reports?status=nope')).body.data.total).toBe(
      all.total
    )
    const second = (await supervisor.call('GET', '/govt/reports?pageSize=25&page=2')).body.data
    expect(second.page).toBe(1)
  })
})

describe('archived trips', () => {
  test('an open report keeps a trip live; once revoked it moves and still says revoked', async () => {
    const id = await certifiedTrip(-45)
    await report(agent, id)
    await archiveDueTrips()
    expect(await getDb().$count(manifests, eq(manifests.id, id))).toBe(1)

    await supervisor.call('POST', `/govt/reports/${await openReportOf(id)}/revoke`, {
      note: 'Forged invoice'
    })
    await archiveDueTrips()
    expect(await getDb().$count(manifests, eq(manifests.id, id))).toBe(0)
    expect(await getDb().$count(archive.manifests, eq(archive.manifests.id, id))).toBe(1)

    // The certificate moved with it; its QR still opens the verify page, which says revoked
    const [certificate] = await getDb()
      .select({ token: archive.certificates.qrToken })
      .from(archive.certificates)
      .where(eq(archive.certificates.manifestId, id))
    const data = await verified(certificate.token)
    expect(data.status).toBe('revoked')
    expect(data.revokedAt).not.toBeNull()

    const company = (await owner.call('GET', `/trips/${id}`)).body.data
    expect(company).toMatchObject({
      archived: true,
      trip: { status: 'revoked' },
      decision: { action: 'revoke', note: 'Forged invoice' }
    })
    const govt = (await supervisor.call('GET', `/govt/trips/${id}`)).body.data
    expect(govt.archived).toBe(true)
    expect(govt.reports[0]).toMatchObject({ status: 'revoked' })
    const list = (await supervisor.call('GET', '/govt/reports?status=revoked')).body.data
    expect(list.rows.map((r: { manifestId: number }) => r.manifestId)).toContain(id)
  })

  test('an archived trip can’t be reported; a report that raced the archive is still decided', async () => {
    const id = await certifiedTrip(-50)
    await archiveDueTrips()
    expect(await getDb().$count(archive.manifests, eq(archive.manifests.id, id))).toBe(1)
    expect((await report(agent, id)).status).toBe(404)

    // As if the report had been filed while the archive job was choosing its batch
    const [agentRow] = await getDb().execute<{ id: number }>(
      sql`select id from users where username = 'review.agent'`
    )
    const [raced] = await getDb()
      .insert(tripReports)
      .values({ manifestId: id, reason: 'other', note: 'Raced', reportedBy: agentRow.id })
      .returning({ id: tripReports.id })
    const result = await supervisor.call('POST', `/govt/reports/${raced.id}/revoke`, {
      note: 'Revoked after archiving'
    })
    expect(result.status).toBe(200)
    expect(result.body.data).toMatchObject({ archived: true, trip: { status: 'revoked' } })
  })
})
