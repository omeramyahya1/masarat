// The government portal: reference data, the dashboard, the search across every company, any trip
// read-only with its attachments, the tax settings, the data export, and the demo regenerate
import { Hono } from 'hono'
import {
  chargeSchema,
  dashboardRequestSchema,
  exportSchema,
  govtSearchQuerySchema,
  settingsSchema
} from '@masarat/shared/schemas'
import { config } from '../config'
import { listCompanies } from '../services/analyticsQuery'
import { getTripDetails } from '../services/billing'
import {
  cachedDashboard,
  cachedHistory,
  cachedToday,
  clearDashboardCache
} from '../services/dashboardCache'
import { aggregateDashboard, resetDashboardFacts } from '../services/dashboardFacts'
import { regenerateDemoData } from '../services/demoData'
import { liftRequestTimeout } from '../http/timeout'
import { findOwnedDocumentFile } from '../services/documents'
import { exportData } from '../services/exports'
import { searchTrips } from '../services/govtTrips'
import { createCharge, getChargesView, updateCharge } from '../services/charges'
import { getSettings, updateSettings } from '../services/settings'
import { getReferenceData } from '../services/trips'
import { fail, idParam, send, type AppEnv } from '../http/context'
import { contentDisposition, sendFile } from '../http/files'
import { requireKind, requirePermission, requireUser } from '../http/middleware'
import { body, doc, query } from '../http/validate'

const EXPORT_TYPES: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  zip: 'application/zip'
}

const download = (name: string, body: ReadableStream<Uint8Array>, rows: object): Response =>
  new Response(body, {
    headers: {
      'Content-Type': EXPORT_TYPES[name.split('.').pop() ?? ''] ?? 'application/octet-stream',
      'Content-Disposition': contentDisposition('attachment', name),
      // Rows written per dataset, for the dialog's summary
      'X-Export-Rows': JSON.stringify(rows),
      'Cache-Control': 'private, no-store'
    }
  })

const G = 'Government'

export const govtRoutes = new Hono<AppEnv>()
  .use(requireUser(), requireKind('govt'))
  .get('/reference', doc(G, 'Cities and states for the filters'), async (c) =>
    send(c, { ok: true, data: await getReferenceData() })
  )
  .get(
    '/companies',
    doc(G, 'Transport companies, for the company filter'),
    requirePermission('govt.dashboard', 'govt.exports'),
    async (c) => send(c, { ok: true, data: await listCompanies() })
  )
  // The filters and view are nested objects, so they come as a JSON body
  .post(
    '/dashboard',
    doc(G, 'The dashboard for filters and a view'),
    requirePermission('govt.dashboard'),
    body(dashboardRequestSchema, 'missing_fields'),
    async (c) => {
      const { filters, view } = c.req.valid('json')
      return send(c, { ok: true, data: await cachedDashboard(filters, view) })
    }
  )
  // The dashboard in two parts the portal adds together: whole past days from the nightly
  // aggregates, and today live (services/dashboardFacts.ts)
  .post(
    '/dashboard/history',
    doc(G, 'The dashboard up to yesterday, from the nightly aggregates'),
    requirePermission('govt.dashboard'),
    body(dashboardRequestSchema, 'missing_fields'),
    async (c) => {
      const { filters, view } = c.req.valid('json')
      return send(c, { ok: true, data: await cachedHistory(filters, view) })
    }
  )
  .post(
    '/dashboard/today',
    doc(G, "The dashboard's today: live figures and the present"),
    requirePermission('govt.dashboard'),
    body(dashboardRequestSchema, 'missing_fields'),
    async (c) => {
      const { filters, view } = c.req.valid('json')
      return send(c, { ok: true, data: await cachedToday(filters, view) })
    }
  )
  .get(
    '/search',
    doc(G, 'Search every company’s trips (paged, capped at 1,000)'),
    requirePermission('govt.search'),
    query(govtSearchQuerySchema),
    async (c) => send(c, await searchTrips(c.req.valid('query')))
  )
  // Opened from the search and from the dashboard's latest bills
  .get(
    '/trips/:id',
    doc(G, 'Any trip, read-only'),
    requirePermission('govt.search', 'govt.dashboard'),
    async (c) => {
      const id = idParam(c)
      return id === null ? fail(c, 'manifest_not_found') : send(c, await getTripDetails(null, id))
    }
  )
  .get(
    '/documents/:id/file',
    doc(G, 'A trip attachment’s file'),
    requirePermission('govt.search', 'govt.dashboard'),
    async (c) => {
      const id = idParam(c)
      return await sendFile(c, id === null ? undefined : await findOwnedDocumentFile(null, id))
    }
  )
  // The validity margin and average speeds
  .get(
    '/settings',
    doc(G, 'Validity margins and average speeds'),
    requirePermission('govt.settings'),
    async (c) => send(c, { ok: true, data: await getSettings() })
  )
  .put(
    '/settings',
    doc(G, 'Change the settings'),
    requirePermission('govt.settings'),
    body(settingsSchema),
    async (c) => send(c, await updateSettings(c.req.valid('json')))
  )
  // Taxes and fees: each change is logged under the signed-in admin
  .get('/charges', doc(G, 'Taxes and fees'), requirePermission('govt.charges'), async (c) =>
    send(c, { ok: true, data: await getChargesView() })
  )
  .post(
    '/charges',
    doc(G, 'Add a tax or fee'),
    requirePermission('govt.charges'),
    body(chargeSchema),
    async (c) => send(c, await createCharge(c.get('user')!.id, c.req.valid('json')))
  )
  .put(
    '/charges/:id',
    doc(G, 'Change a tax or fee'),
    requirePermission('govt.charges'),
    body(chargeSchema),
    async (c) => {
      const id = idParam(c)
      if (id === null) return fail(c, 'charge_not_found')
      return send(c, await updateCharge(c.get('user')!.id, id, c.req.valid('json')))
    }
  )
  // One file as is; several as one ZIP. Built on disk first (services/exports.ts), then streamed
  // from there; the folder goes once the download is sent.
  .post(
    '/exports',
    doc(G, 'Export trips and bills as Excel or CSV (a file, or a ZIP of several)'),
    requirePermission('govt.exports'),
    body(exportSchema, 'missing_fields'),
    async (c) => {
      liftRequestTimeout(c)
      const result = await exportData(c.req.valid('json'))
      if (!result.ok) return c.json(result, 413)
      const { download: file, rows, cleanup } = result.data
      const body = Bun.file(file.path)
        .stream()
        .pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ flush: cleanup }))
      return download(file.name, body, rows)
    }
  )
  // Demo only
  .post('/demo/regenerate', doc(G, 'Demo only: regenerate the demo data'), async (c) => {
    if (!config.demoMode) return fail(c, 'forbidden')
    liftRequestTimeout(c)
    await regenerateDemoData()
    // Every day's figures changed: the aggregates are computed again, and the cache dropped
    await resetDashboardFacts()
    await aggregateDashboard()
    await clearDashboardCache()
    return send(c, { ok: true, data: null })
  })
