import { desc, eq, inArray } from 'drizzle-orm'
import { cities, getDb, manifests, taxRates, vehicles } from '../db'
import {
  CARGO_TYPES,
  type CargoType,
  type FleetResult,
  type TripInput,
  type TripRecord,
  type TripReferenceData
} from '../../shared/fleet'
import { calculateTax, estimateRoadKm } from '../../shared/tax'
import { findOwnedVehicle } from './fleet'

const isCargoType = (value: unknown): value is CargoType =>
  (CARGO_TYPES as readonly unknown[]).includes(value)

// "YYYY-MM-DD" as local midnight, or null if it isn't a real calendar date
function parseTripDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(year, month - 1, day)
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

export function getReferenceData(): TripReferenceData {
  const db = getDb()
  return {
    cities: db
      .select({
        id: cities.id,
        name: cities.name,
        nameAr: cities.nameAr,
        state: cities.state,
        lat: cities.lat,
        lng: cities.lng
      })
      .from(cities)
      .orderBy(cities.name)
      .all(),
    taxRates: db
      .select({
        cargoType: taxRates.cargoType,
        ratePerKm: taxRates.ratePerKm,
        unit: taxRates.unit,
        perQuantity: taxRates.perQuantity
      })
      .from(taxRates)
      .all()
  }
}

// Columns of a TripRecord; select from manifests joined with vehicles
export const tripColumns = {
  id: manifests.id,
  vehicleId: manifests.vehicleId,
  plateNumber: vehicles.plateNumber,
  vehicleType: vehicles.vehicleType,
  originCityId: manifests.originCityId,
  destinationCityId: manifests.destinationCityId,
  cargoType: manifests.cargoType,
  cargoQuantity: manifests.cargoQuantity,
  cargoUnit: manifests.cargoUnit,
  tripDate: manifests.tripDate,
  distanceKm: manifests.distanceKm,
  ratePerKm: manifests.ratePerKm,
  taxAmount: manifests.taxAmount,
  status: manifests.status,
  createdAt: manifests.createdAt
}

type TripRow = Omit<TripRecord, 'tripDate' | 'createdAt'> & { tripDate: Date; createdAt: Date }

export const toTripRecord = (row: TripRow): TripRecord => ({
  ...row,
  tripDate: row.tripDate.getTime(),
  createdAt: row.createdAt.getTime()
})

export function listTrips(ownerId: number): TripRecord[] {
  return getDb()
    .select(tripColumns)
    .from(manifests)
    .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
    .where(eq(vehicles.ownerId, ownerId))
    .orderBy(desc(manifests.createdAt), desc(manifests.id))
    .all()
    .map(toTripRecord)
}

// Recomputes the tax from the DB rates (the renderer's preview is never trusted) and saves a draft
export function createTrip(ownerId: number, input: TripInput): FleetResult<TripRecord> {
  if (!input || !isCargoType(input.cargoType)) return { ok: false, error: 'missing_fields' }

  const vehicle = findOwnedVehicle(ownerId, input.vehicleId)
  if (!vehicle) return { ok: false, error: 'vehicle_not_found' }

  if (input.originCityId === input.destinationCityId) return { ok: false, error: 'same_route' }
  const db = getDb()
  const route = db
    .select()
    .from(cities)
    .where(inArray(cities.id, [input.originCityId, input.destinationCityId]))
    .all()
  const origin = route.find((c) => c.id === input.originCityId)
  const destination = route.find((c) => c.id === input.destinationCityId)
  if (!origin || !destination) return { ok: false, error: 'city_not_found' }

  const quantity = input.cargoQuantity
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, error: 'invalid_quantity' }
  }

  const rate = db.select().from(taxRates).where(eq(taxRates.cargoType, input.cargoType)).get()
  if (!rate) return { ok: false, error: 'unknown' }
  // Cargo is measured in the rate's unit, which has to match what the vehicle carries
  if (rate.unit !== vehicle.capacityUnit) return { ok: false, error: 'unit_mismatch' }
  if (quantity > vehicle.capacity) return { ok: false, error: 'over_capacity' }

  const tripDate = parseTripDate(input.tripDate)
  if (!tripDate) return { ok: false, error: 'invalid_date' }

  const distanceKm = estimateRoadKm(origin, destination)
  const created = db
    .insert(manifests)
    .values({
      vehicleId: vehicle.id,
      originCityId: origin.id,
      destinationCityId: destination.id,
      cargoType: input.cargoType,
      cargoQuantity: quantity,
      cargoUnit: rate.unit,
      tripDate,
      distanceKm,
      ratePerKm: rate.ratePerKm,
      taxAmount: calculateTax(rate, distanceKm, quantity),
      status: 'draft'
    })
    .returning()
    .get()

  return {
    ok: true,
    data: {
      id: created.id,
      vehicleId: created.vehicleId,
      plateNumber: vehicle.plateNumber,
      vehicleType: vehicle.vehicleType,
      originCityId: created.originCityId,
      destinationCityId: created.destinationCityId,
      cargoType: created.cargoType,
      cargoQuantity: created.cargoQuantity,
      cargoUnit: created.cargoUnit,
      tripDate: created.tripDate.getTime(),
      distanceKm: created.distanceKm,
      ratePerKm: created.ratePerKm,
      taxAmount: created.taxAmount,
      status: created.status,
      createdAt: created.createdAt.getTime()
    }
  }
}
