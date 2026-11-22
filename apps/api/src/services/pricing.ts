// What a trip costs before taxes and fees. The real pricing (how cargo and tickets are priced in
// practice) isn't known yet, so development uses a formula: a rate per km for each cargo type
// (pricing_rates, per its unit), and a rate per km per seat for a ticket. Production refuses to
// start with it (assertPricingAllowed): a real PricingService has to replace FormulaPricing first.
import { asc } from 'drizzle-orm'
import { getDb, pricingRates } from '../db'
import { config } from '../config'
import {
  CARGO_TYPES,
  type CargoItem,
  type CargoRateRecord,
  type CargoType
} from '@masarat/shared/fleet'
import { calculateItemsCost, calculateTicketPrice } from '@masarat/shared/tax'

type Db =
  Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0] | ReturnType<typeof getDb>

export interface PricingService {
  // The development formula, which production refuses
  readonly isFormula: boolean
  // The cargo rates (for the form's preview, the item snapshots and the unit checks)
  cargoRates(db?: Db): Promise<CargoRateRecord[]>
  // Each item's cost, the total and the costliest type; null if an item's type has no rate
  cargoCost(
    items: readonly Pick<CargoItem, 'cargoType' | 'quantity' | 'unit'>[],
    distanceKm: number,
    db?: Db
  ): Promise<{ costs: number[]; total: number; mainType: CargoType | null } | null>
  // The price of one ticket for this distance
  ticketRatePerKm(db?: Db): Promise<number>
  ticketPrice(distanceKm: number, db?: Db): Promise<number>
}

const isCargoType = (code: string): code is CargoType => CARGO_TYPES.includes(code as CargoType)

class FormulaPricing implements PricingService {
  readonly isFormula = true

  async cargoRates(db: Db = getDb()): Promise<CargoRateRecord[]> {
    const rows = await db.select().from(pricingRates).orderBy(asc(pricingRates.id))
    return rows.flatMap((r) =>
      isCargoType(r.code) && r.unit !== 'seat'
        ? [{ cargoType: r.code, ratePerKm: r.ratePerKm, unit: r.unit, perQuantity: r.perQuantity }]
        : []
    )
  }

  async cargoCost(
    items: readonly Pick<CargoItem, 'cargoType' | 'quantity' | 'unit'>[],
    distanceKm: number,
    db: Db = getDb()
  ): Promise<{ costs: number[]; total: number; mainType: CargoType | null } | null> {
    return calculateItemsCost(items, await this.cargoRates(db), distanceKm)
  }

  async ticketRatePerKm(db: Db = getDb()): Promise<number> {
    const rows = await db.select().from(pricingRates)
    return rows.find((r) => r.code === 'passenger')?.ratePerKm ?? 0
  }

  async ticketPrice(distanceKm: number, db: Db = getDb()): Promise<number> {
    return calculateTicketPrice(await this.ticketRatePerKm(db), distanceKm)
  }
}

export const pricing: PricingService = new FormulaPricing()

// Run at startup: in production, the development formula isn't an acceptable price
export function assertPricingAllowed(service: PricingService = pricing): void {
  if (config.appEnv === 'production' && service.isFormula) {
    throw new Error(
      'APP_ENV=production, but trips are still priced by the development formula. ' +
        'Integrate the real pricing (a PricingService in services/pricing.ts) before running in production.'
    )
  }
}
