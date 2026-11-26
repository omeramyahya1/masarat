// Government portal → Reports: any government user who may report files a report on an issued
// clearance; supervisors and the admin list the reports and dismiss them or revoke the clearance
// (services/reviews.ts). Each change answers the trip's page, as the government sees it.
import { Hono } from 'hono'
import {
  decisionSchema,
  dismissSchema,
  reportListQuerySchema,
  reportSchema
} from '@masarat/shared/schemas'
import type { FleetResult } from '@masarat/shared/fleet'
import { getTripDetails } from '../services/billing'
import { dismissReport, listReports, reportTrip, revokeReport } from '../services/reviews'
import { fail, idParam, send, type AppContext, type AppEnv } from '../http/context'
import { requireKind, requirePermission, requireUser } from '../http/middleware'
import { body, doc, query } from '../http/validate'

const G = 'Government reports'

// A review action's result: the trip's page once it succeeded
export async function sendTrip(
  c: AppContext,
  result: FleetResult<{ manifestId: number }>
): Promise<Response> {
  return send(c, result.ok ? await getTripDetails(null, result.data.manifestId) : result)
}

export const govtReportRoutes = new Hono<AppEnv>()
  .use(requireUser(), requireKind('govt'))
  .get(
    '/',
    doc(G, 'The reports, newest first (paged, by status)'),
    requirePermission('govt.reports.review'),
    query(reportListQuerySchema),
    async (c) => send(c, { ok: true, data: await listReports(c.req.valid('query')) })
  )
  .post(
    '/',
    doc(G, 'Report a certified trip’s clearance (one open report per trip)'),
    requirePermission('govt.reports.create'),
    body(reportSchema),
    async (c) => sendTrip(c, await reportTrip(c.get('user')!.id, c.req.valid('json')))
  )
  .post(
    '/:id/dismiss',
    doc(G, 'Dismiss a report: the clearance stays valid'),
    requirePermission('govt.reports.review'),
    body(dismissSchema),
    async (c) => {
      const id = idParam(c)
      if (id === null) return fail(c, 'report_not_found')
      return sendTrip(c, await dismissReport(c.get('user')!.id, id, c.req.valid('json')))
    }
  )
  .post(
    '/:id/revoke',
    doc(G, 'Revoke the clearance a report is about'),
    requirePermission('govt.reports.review'),
    body(decisionSchema),
    async (c) => {
      const id = idParam(c)
      if (id === null) return fail(c, 'report_not_found')
      return sendTrip(c, await revokeReport(c.get('user')!.id, id, c.req.valid('json')))
    }
  )
