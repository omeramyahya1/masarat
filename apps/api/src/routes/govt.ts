// The government portal: reference data, the dashboard, the search across every company, any trip
// read-only with its attachments, the tax settings, the data export, and the demo regenerate
import { Hono } from 'hono'
import { isAnalyticsFilters, isDashboardView } from '@masarat/shared/analytics'
import { isExportOptions, type ExportInput } from '@masarat/shared/exports'
import type { GovtSearchInput } from '@masarat/shared/billing'
import type { SystemSettings } from '@masarat/shared/settings'
import type { ChargeInput } from '@masarat/shared/tax'
import { config } from '../config'
import { listCompanies } from '../services/analyticsQuery'
import { getTripDetails } from '../services/billing'
import { getDashboard } from '../services/dashboard'
import { regenerateDemoData } from '../services/demoData'
import { liftRequestTimeout } from '../http/timeout'
import { findOwnedDocumentFile } from '../services/documents'
import { exportData } from '../services/exports'
import { searchTrips } from '../services/govtTrips'
import { createCharge, getChargesView, updateCharge } from '../services/charges'
import { getSettings, updateSettings } from '../services/settings'
import { getReferenceData } from '../services/trips'
import { fail, idParam, readJson, send, type AppEnv } from '../http/context'
import { contentDisposition, sendFile } from '../http/files'
import { requireKind, requirePermission, requireUser } from '../http/middleware'

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

const positiveInt = (value: string | undefined): number | undefined => {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

export const govtRoutes = new Hono<AppEnv>()
  .use(requireUser(), requireKind('govt'))
  .get('/reference', async (c) => send(c, { ok: true, data: await getReferenceData() }))
  .get('/companies', requirePermission('govt.dashboard', 'govt.exports'), async (c) =>
    send(c, { ok: true, data: await listCompanies() })
  )
  // The filters and view are nested objects, so they come as a JSON body
  .post('/dashboard', requirePermission('govt.dashboard'), async (c) => {
    const { filters, view } = await readJson(c)
    if (!isAnalyticsFilters(filters) || !isDashboardView(view)) return fail(c, 'missing_fields')
    return send(c, { ok: true, data: await getDashboard(filters, view) })
  })
  .get('/search', requirePermission('govt.search'), async (c) => {
    const q = c.req.query()
    const input: GovtSearchInput = {
      query: q.query ?? '',
      originCityId: positiveInt(q.originCityId) ?? null,
      destinationCityId: positiveInt(q.destinationCityId) ?? null,
      page: positiveInt(q.page),
      pageSize: positiveInt(q.pageSize)
    }
    return send(c, await searchTrips(input))
  })
  // Opened from the search and from the dashboard's latest bills
  .get('/trips/:id', requirePermission('govt.search', 'govt.dashboard'), async (c) => {
    const id = idParam(c)
    return id === null ? fail(c, 'manifest_not_found') : send(c, await getTripDetails(null, id))
  })
  .get('/documents/:id/file', requirePermission('govt.search', 'govt.dashboard'), async (c) => {
    const id = idParam(c)
    return sendFile(c, id === null ? undefined : await findOwnedDocumentFile(null, id))
  })
  // The validity margin and average speeds
  .get('/settings', requirePermission('govt.settings'), async (c) =>
    send(c, { ok: true, data: await getSettings() })
  )
  .put('/settings', requirePermission('govt.settings'), async (c) =>
    send(c, await updateSettings((await readJson(c)) as unknown as SystemSettings))
  )
  // Taxes and fees: each change is logged under the signed-in admin
  .get('/charges', requirePermission('govt.charges'), async (c) =>
    send(c, { ok: true, data: await getChargesView() })
  )
  .post('/charges', requirePermission('govt.charges'), async (c) =>
    send(c, await createCharge(c.get('user')!.id, (await readJson(c)) as unknown as ChargeInput))
  )
  .put('/charges/:id', requirePermission('govt.charges'), async (c) => {
    const id = idParam(c)
    if (id === null) return fail(c, 'charge_not_found')
    const input = (await readJson(c)) as unknown as ChargeInput
    return send(c, await updateCharge(c.get('user')!.id, id, input))
  })
  // One file as is; several as one ZIP. Built on disk first (services/exports.ts), then streamed
  // from there; the folder goes once the download is sent.
  .post('/exports', requirePermission('govt.exports'), async (c) => {
    const input = (await readJson(c)) as unknown as ExportInput
    if (!isAnalyticsFilters(input?.filters) || !isExportOptions(input)) {
      return fail(c, 'missing_fields')
    }
    liftRequestTimeout(c)
    const result = await exportData(input)
    if (!result.ok) return c.json(result, 413)
    const { download: file, rows, cleanup } = result.data
    const body = Bun.file(file.path)
      .stream()
      .pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ flush: cleanup }))
    return download(file.name, body, rows)
  })
  // Demo only
  .post('/demo/regenerate', async (c) => {
    if (!config.demoMode) return fail(c, 'forbidden')
    liftRequestTimeout(c)
    await regenerateDemoData()
    return send(c, { ok: true, data: null })
  })
