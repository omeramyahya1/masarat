// Tax percentages (VAT, business profit, locality) and their change log. Any government account
// can change them for the MVP; each change records who made it.
import { desc, eq } from 'drizzle-orm'
import { getDb, taxSettingChanges, taxSettings, users } from '../db'
import type { FleetResult } from '../../shared/fleet'
import { MAX_TAX_BPS, TAX_CODES, type TaxRatesInput, type TaxSettingsView } from '../../shared/tax'
import { getTaxSettings } from './trips'

const HISTORY_LIMIT = 20

export function getTaxSettingsView(): TaxSettingsView {
  const db = getDb()
  return {
    rates: getTaxSettings(db),
    history: db
      .select({
        code: taxSettingChanges.code,
        oldBps: taxSettingChanges.oldBps,
        newBps: taxSettingChanges.newBps,
        changedBy: users.fullName,
        changedAt: taxSettingChanges.changedAt
      })
      .from(taxSettingChanges)
      .innerJoin(users, eq(taxSettingChanges.changedBy, users.id))
      .orderBy(desc(taxSettingChanges.changedAt), desc(taxSettingChanges.id))
      .limit(HISTORY_LIMIT)
      .all()
      .map((change) => ({ ...change, changedAt: change.changedAt.getTime() }))
  }
}

// Whole basis points from 0 to 100% (two decimals of a percent)
const isValidBps = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_TAX_BPS

export function updateTaxRates(userId: number, input: TaxRatesInput): FleetResult<TaxSettingsView> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'missing_fields' }
  const changes = TAX_CODES.filter((code) => input[code] !== undefined)
  if (changes.some((code) => !isValidBps(input[code]))) {
    return { ok: false, error: 'invalid_tax_rate' }
  }

  const db = getDb()
  db.transaction((tx) => {
    const current = new Map(getTaxSettings(tx).map((s) => [s.code, s.rateBps]))
    const changedAt = new Date()
    for (const code of changes) {
      const newBps = input[code] as number
      const oldBps = current.get(code)
      if (oldBps === newBps) continue
      if (oldBps === undefined) tx.insert(taxSettings).values({ code, rateBps: newBps }).run()
      else tx.update(taxSettings).set({ rateBps: newBps }).where(eq(taxSettings.code, code)).run()
      tx.insert(taxSettingChanges)
        .values({ code, oldBps: oldBps ?? 0, newBps, changedBy: userId, changedAt })
        .run()
    }
  })
  return { ok: true, data: getTaxSettingsView() }
}
