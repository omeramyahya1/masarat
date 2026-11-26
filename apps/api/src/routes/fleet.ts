// The company's vehicles and drivers. The trip form and the trips list read them too.
import { Hono } from 'hono'
import { driverSchema, vehicleSchema } from '@masarat/shared/schemas'
import { addVehicle, deleteVehicle, listVehicles, updateVehicle } from '../services/fleet'
import { addDriver, deleteDriver, listDrivers, updateDriver } from '../services/drivers'
import { fail, idParam, send, type AppEnv } from '../http/context'
import { companyId, requireCompany } from '../http/company'
import { requirePermission } from '../http/middleware'
import { body, doc } from '../http/validate'

export const vehicleRoutes = new Hono<AppEnv>()
  .use(...requireCompany)
  .get(
    '/',
    doc('Vehicles', 'The company’s vehicles'),
    requirePermission('fleet.view', 'trips.view'),
    async (c) => send(c, { ok: true, data: await listVehicles(companyId(c)) })
  )
  .use('*', async (c, next) =>
    c.req.method === 'GET' ? next() : requirePermission('fleet.manage')(c, next)
  )
  .post('/', doc('Vehicles', 'Add a vehicle'), body(vehicleSchema), async (c) =>
    send(c, await addVehicle(companyId(c), c.req.valid('json')))
  )
  .put('/:id', doc('Vehicles', 'Edit a vehicle'), body(vehicleSchema), async (c) => {
    const id = idParam(c)
    if (id === null) return fail(c, 'vehicle_not_found')
    return send(c, await updateVehicle(companyId(c), id, c.req.valid('json')))
  })
  .delete('/:id', doc('Vehicles', 'Delete a vehicle without trips'), async (c) => {
    const id = idParam(c)
    return id === null
      ? fail(c, 'vehicle_not_found')
      : send(c, await deleteVehicle(companyId(c), id))
  })

export const driverRoutes = new Hono<AppEnv>()
  .use(...requireCompany)
  .get(
    '/',
    doc('Drivers', 'The company’s drivers'),
    requirePermission('drivers.view', 'trips.view'),
    async (c) => send(c, { ok: true, data: await listDrivers(companyId(c)) })
  )
  .use('*', async (c, next) =>
    c.req.method === 'GET' ? next() : requirePermission('drivers.manage')(c, next)
  )
  .post('/', doc('Drivers', 'Add a driver'), body(driverSchema), async (c) =>
    send(c, await addDriver(companyId(c), c.req.valid('json')))
  )
  .put('/:id', doc('Drivers', 'Edit a driver'), body(driverSchema), async (c) => {
    const id = idParam(c)
    if (id === null) return fail(c, 'driver_not_found')
    return send(c, await updateDriver(companyId(c), id, c.req.valid('json')))
  })
  .delete('/:id', doc('Drivers', 'Delete a driver'), async (c) => {
    const id = idParam(c)
    return id === null ? fail(c, 'driver_not_found') : send(c, await deleteDriver(companyId(c), id))
  })
