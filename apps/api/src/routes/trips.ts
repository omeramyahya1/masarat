// The company's trips (a branch member's: their branch's): the list (paged), the form's data,
// saving drafts, and billing
import { Hono } from 'hono'
import { tripListQuerySchema, tripSchema } from '@masarat/shared/schemas'
import {
  createTrip,
  deleteTrip,
  getReferenceData,
  listSuggestions,
  updateTrip
} from '../services/trips'
import { listTripsPage } from '../services/tripList'
import {
  generateBill,
  getTripDetails,
  refreshBillStatus,
  simulatePayment
} from '../services/billing'
import { fail, idParam, send, type AppEnv } from '../http/context'
import { body, doc, query } from '../http/validate'
import { companyScope, requireCompany, userId } from '../http/company'
import { requirePermission } from '../http/middleware'

const T = 'Trips'

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
  .get('/reference', doc(T, 'Cities, states and rates for the trip form'), async (c) =>
    send(c, { ok: true, data: await getReferenceData() })
  )
  .get('/suggestions', doc(T, 'Recent senders, receivers and packing types'), async (c) =>
    send(c, { ok: true, data: await listSuggestions(companyScope(c)) })
  )
  .get(
    '/',
    doc(T, 'A page of the period’s trips', 'Filtered, searched, sorted and grouped'),
    query(tripListQuerySchema),
    async (c) => send(c, await listTripsPage(companyScope(c), c.req.valid('query')))
  )
  .post('/', doc(T, 'Save a new draft trip'), body(tripSchema), async (c) =>
    send(c, await createTrip(companyScope(c), userId(c), c.req.valid('json')))
  )
  .get('/:id', doc(T, 'A trip with its bill and documents'), async (c) => {
    const id = idParam(c)
    return id === null
      ? fail(c, 'manifest_not_found')
      : send(c, await getTripDetails(companyScope(c), id))
  })
  .put('/:id', doc(T, 'Edit a draft trip'), body(tripSchema), async (c) => {
    const id = idParam(c)
    if (id === null) return fail(c, 'manifest_not_found')
    return send(c, await updateTrip(companyScope(c), userId(c), id, c.req.valid('json')))
  })
  .delete('/:id', doc(T, 'Delete a draft trip'), async (c) => {
    const id = idParam(c)
    return id === null
      ? fail(c, 'manifest_not_found')
      : send(c, await deleteTrip(companyScope(c), id))
  })
  .post('/:id/bill', doc(T, 'Generate the E-Sali bill ID'), async (c) => {
    const id = idParam(c)
    return id === null
      ? fail(c, 'manifest_not_found')
      : send(c, await generateBill(companyScope(c), id))
  })
  .post('/:id/refresh', doc(T, 'Ask E-Sali whether the bill is paid'), async (c) => {
    const id = idParam(c)
    return id === null
      ? fail(c, 'manifest_not_found')
      : send(c, await refreshBillStatus(companyScope(c), id))
  })
  // Demo only (the service refuses outside demo mode)
  .post(
    '/:id/simulate-payment',
    doc(T, 'Demo only: pay the bill at the simulated E-Sali'),
    async (c) => {
      const id = idParam(c)
      return id === null
        ? fail(c, 'manifest_not_found')
        : send(c, await simulatePayment(companyScope(c), id))
    }
  )
