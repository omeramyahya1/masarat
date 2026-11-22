// The company's vehicles and drivers. The trip form and the trips list read them too.
import { Hono } from 'hono'
import type { DriverInput, VehicleInput } from '@masarat/shared/fleet'
import { addVehicle, deleteVehicle, listVehicles, updateVehicle } from '../services/fleet'
import { addDriver, deleteDriver, listDrivers, updateDriver } from '../services/drivers'
import { fail, idParam, readJson, send, type AppEnv } from '../http/context'
import { companyId, requireCompany } from '../http/company'
import { requirePermission } from '../http/middleware'

export const vehicleRoutes = new Hono<AppEnv>()
  .use(...requireCompany)
  .get('/', requirePermission('fleet.view', 'trips.view'), async (c) =>
    send(c, { ok: true, data: await listVehicles(companyId(c)) })
  )
  .use('*', async (c, next) =>
    c.req.method === 'GET' ? next() : requirePermission('fleet.manage')(c, next)
  )
  .post('/', async (c) =>
    send(c, await addVehicle(companyId(c), (await readJson(c)) as unknown as VehicleInput))
  )
  .put('/:id', async (c) => {
    const id = idParam(c)
    if (id === null) return fail(c, 'vehicle_not_found')
    return send(
      c,
      await updateVehicle(companyId(c), id, (await readJson(c)) as unknown as VehicleInput)
    )
  })
  .delete('/:id', async (c) => {
    const id = idParam(c)
    return id === null
      ? fail(c, 'vehicle_not_found')
      : send(c, await deleteVehicle(companyId(c), id))
  })

export const driverRoutes = new Hono<AppEnv>()
  .use(...requireCompany)
  .get('/', requirePermission('drivers.view', 'trips.view'), async (c) =>
    send(c, { ok: true, data: await listDrivers(companyId(c)) })
  )
  .use('*', async (c, next) =>
    c.req.method === 'GET' ? next() : requirePermission('drivers.manage')(c, next)
  )
  .post('/', async (c) =>
    send(c, await addDriver(companyId(c), (await readJson(c)) as unknown as DriverInput))
  )
  .put('/:id', async (c) => {
    const id = idParam(c)
    if (id === null) return fail(c, 'driver_not_found')
    return send(
      c,
      await updateDriver(companyId(c), id, (await readJson(c)) as unknown as DriverInput)
    )
  })
  .delete('/:id', async (c) => {
    const id = idParam(c)
    return id === null ? fail(c, 'driver_not_found') : send(c, await deleteDriver(companyId(c), id))
  })
