// The company's trips (a branch member's: their branch's): the list (paged), the form's data,
// saving drafts, and billing
import { Hono } from 'hono'
import type { TripInput } from '@masarat/shared/fleet'
import {
  createTrip,
  deleteTrip,
  getReferenceData,
  listSuggestions,
  updateTrip
} from '../services/trips'
import { listTripsPage, parseTripListQuery } from '../services/tripList'
import {
  generateBill,
  getTripDetails,
  refreshBillStatus,
  simulatePayment
} from '../services/billing'
import { fail, idParam, readJson, send, type AppEnv } from '../http/context'
import { companyScope, requireCompany, userId } from '../http/company'
import { requirePermission } from '../http/middleware'

export const tripRoutes = new Hono<AppEnv>()
  .use(...requireCompany)
  // Seeing trips needs trips.view; drafts need trips.edit, bills trips.bill. The reference data
  // (cities, rates) is for every member: the Branches section picks cities too.
  .use('*', async (c, next) => {
    const path = c.req.path
    if (c.req.method === 'GET' && path.endsWith('/reference')) return next()
    const needed =
      c.req.method === 'GET'
        ? 'trips.view'
        : /\/(bill|refresh|simulate-payment)$/.test(path)
          ? 'trips.bill'
          : 'trips.edit'
    return requirePermission(needed)(c, next)
  })
  .get('/reference', async (c) => send(c, { ok: true, data: await getReferenceData() }))
  .get('/suggestions', async (c) =>
    send(c, { ok: true, data: await listSuggestions(companyScope(c)) })
  )
  .get('/', async (c) =>
    send(c, await listTripsPage(companyScope(c), parseTripListQuery(c.req.query())))
  )
  .post('/', async (c) =>
    send(
      c,
      await createTrip(companyScope(c), userId(c), (await readJson(c)) as unknown as TripInput)
    )
  )
  .get('/:id', async (c) => {
    const id = idParam(c)
    return id === null
      ? fail(c, 'manifest_not_found')
      : send(c, await getTripDetails(companyScope(c), id))
  })
  .put('/:id', async (c) => {
    const id = idParam(c)
    if (id === null) return fail(c, 'manifest_not_found')
    return send(
      c,
      await updateTrip(companyScope(c), userId(c), id, (await readJson(c)) as unknown as TripInput)
    )
  })
  .delete('/:id', async (c) => {
    const id = idParam(c)
    return id === null
      ? fail(c, 'manifest_not_found')
      : send(c, await deleteTrip(companyScope(c), id))
  })
  .post('/:id/bill', async (c) => {
    const id = idParam(c)
    return id === null
      ? fail(c, 'manifest_not_found')
      : send(c, await generateBill(companyScope(c), id))
  })
  .post('/:id/refresh', async (c) => {
    const id = idParam(c)
    return id === null
      ? fail(c, 'manifest_not_found')
      : send(c, await refreshBillStatus(companyScope(c), id))
  })
  // Demo only (the service refuses outside demo mode)
  .post('/:id/simulate-payment', async (c) => {
    const id = idParam(c)
    return id === null
      ? fail(c, 'manifest_not_found')
      : send(c, await simulatePayment(companyScope(c), id))
  })
