// The fleet owner's trips: the list (paged), the form's data, saving drafts, and billing
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
import { fail, readJson, send, type AppEnv } from '../http/context'
import { idParam, ownerId, requireOwner } from '../http/owner'

export const tripRoutes = new Hono<AppEnv>()
  .use(...requireOwner)
  .get('/reference', async (c) => send(c, { ok: true, data: await getReferenceData() }))
  .get('/suggestions', async (c) => send(c, { ok: true, data: await listSuggestions(ownerId(c)) }))
  .get('/', async (c) =>
    send(c, await listTripsPage(ownerId(c), parseTripListQuery(c.req.query())))
  )
  .post('/', async (c) =>
    send(c, await createTrip(ownerId(c), (await readJson(c)) as unknown as TripInput))
  )
  .get('/:id', async (c) => {
    const id = idParam(c)
    return id === null
      ? fail(c, 'manifest_not_found')
      : send(c, await getTripDetails(ownerId(c), id))
  })
  .put('/:id', async (c) => {
    const id = idParam(c)
    if (id === null) return fail(c, 'manifest_not_found')
    return send(c, await updateTrip(ownerId(c), id, (await readJson(c)) as unknown as TripInput))
  })
  .delete('/:id', async (c) => {
    const id = idParam(c)
    return id === null ? fail(c, 'manifest_not_found') : send(c, await deleteTrip(ownerId(c), id))
  })
  .post('/:id/bill', async (c) => {
    const id = idParam(c)
    return id === null ? fail(c, 'manifest_not_found') : send(c, await generateBill(ownerId(c), id))
  })
  .post('/:id/refresh', async (c) => {
    const id = idParam(c)
    return id === null
      ? fail(c, 'manifest_not_found')
      : send(c, await refreshBillStatus(ownerId(c), id))
  })
  // Demo only (the service refuses outside demo mode)
  .post('/:id/simulate-payment', async (c) => {
    const id = idParam(c)
    return id === null
      ? fail(c, 'manifest_not_found')
      : send(c, await simulatePayment(ownerId(c), id))
  })
