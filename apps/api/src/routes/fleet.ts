// The fleet owner's vehicles and drivers
import { Hono } from 'hono'
import type { DriverInput, VehicleInput } from '@masarat/shared/fleet'
import { addVehicle, deleteVehicle, listVehicles, updateVehicle } from '../services/fleet'
import { addDriver, deleteDriver, listDrivers, updateDriver } from '../services/drivers'
import { fail, readJson, send, type AppEnv } from '../http/context'
import { idParam, ownerId, requireOwner } from '../http/owner'

export const vehicleRoutes = new Hono<AppEnv>()
  .use(...requireOwner)
  .get('/', async (c) => send(c, { ok: true, data: await listVehicles(ownerId(c)) }))
  .post('/', async (c) =>
    send(c, await addVehicle(ownerId(c), (await readJson(c)) as unknown as VehicleInput))
  )
  .put('/:id', async (c) => {
    const id = idParam(c)
    if (id === null) return fail(c, 'vehicle_not_found')
    return send(
      c,
      await updateVehicle(ownerId(c), id, (await readJson(c)) as unknown as VehicleInput)
    )
  })
  .delete('/:id', async (c) => {
    const id = idParam(c)
    return id === null ? fail(c, 'vehicle_not_found') : send(c, await deleteVehicle(ownerId(c), id))
  })

export const driverRoutes = new Hono<AppEnv>()
  .use(...requireOwner)
  .get('/', async (c) => send(c, { ok: true, data: await listDrivers(ownerId(c)) }))
  .post('/', async (c) =>
    send(c, await addDriver(ownerId(c), (await readJson(c)) as unknown as DriverInput))
  )
  .put('/:id', async (c) => {
    const id = idParam(c)
    if (id === null) return fail(c, 'driver_not_found')
    return send(
      c,
      await updateDriver(ownerId(c), id, (await readJson(c)) as unknown as DriverInput)
    )
  })
  .delete('/:id', async (c) => {
    const id = idParam(c)
    return id === null ? fail(c, 'driver_not_found') : send(c, await deleteDriver(ownerId(c), id))
  })
