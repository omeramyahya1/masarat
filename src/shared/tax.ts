// Trip tax calculation, shared so the renderer can preview exactly what the main process saves
import type { TaxRateRecord } from './fleet'

interface Point {
  lat: number
  lng: number
}

const EARTH_RADIUS_KM = 6371

// Roads are longer than the straight line between two cities; this approximates the detour
// until a real routing service is integrated
export const ROAD_FACTOR = 1.3

export function haversineKm(a: Point, b: Point): number {
  const rad = (deg: number): number => (deg * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

// Estimated road distance, in whole km
export function estimateRoadKm(origin: Point, destination: Point): number {
  return Math.round(haversineKm(origin, destination) * ROAD_FACTOR)
}

// tax = ratePerKm * distanceKm * (quantity / perQuantity), in whole SDG
export function calculateTax(
  rate: Pick<TaxRateRecord, 'ratePerKm' | 'perQuantity'>,
  distanceKm: number,
  quantity: number
): number {
  return Math.round((rate.ratePerKm * distanceKm * quantity) / rate.perQuantity)
}
