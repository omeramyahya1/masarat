// Tax percentages (VAT, business profit, locality), fixed fees (manifest fee) and their change
// log. Any government account can change them for the MVP; each change records who made it.
import { desc, eq } from 'drizzle-orm'
import { getDb, taxSettingChanges, taxSettings, users } from '../db'
import type { FleetResult } from '../../shared/fleet'
import {
  LINE_CODES,
  MAX_FEE,
  MAX_TAX_BPS,
  isFeeCode,
  type LineCode,
  type TaxRatesInput,
  type TaxSettingsView
} from '../../shared/tax'
import { getFeeSettings, getTaxSettings } from './trips'

const HISTORY_LIMIT = 20

export function getTaxSettingsView(): TaxSettingsView {
  const db = getDb()
  return {
    rates: getTaxSettings(db),
    fees: getFeeSettings(db),
    history: db
      .select({
        code: taxSettingChanges.code,
        oldValue: taxSettingChanges.oldValue,
        newValue: taxSettingChanges.newValue,
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

// A tax: whole basis points from 0 to 100% (two decimals of a percent). A fee: whole SDG.
const isValidValue = (code: LineCode, value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= (isFeeCode(code) ? MAX_FEE : MAX_TAX_BPS)

export function updateTaxRates(userId: number, input: TaxRatesInput): FleetResult<TaxSettingsView> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'missing_fields' }
  const changes = LINE_CODES.filter((code) => input[code] !== undefined)
  const invalid = changes.find((code) => !isValidValue(code, input[code]))
  if (invalid) return { ok: false, error: isFeeCode(invalid) ? 'invalid_fee' : 'invalid_tax_rate' }

  const db = getDb()
  db.transaction((tx) => {
    const current = new Map<LineCode, number>([
      ...getTaxSettings(tx).map((s) => [s.code, s.rateBps] as const),
      ...getFeeSettings(tx).map((f) => [f.code, f.amount] as const)
    ])
    const changedAt = new Date()
    for (const code of changes) {
      const newValue = input[code] as number
      const oldValue = current.get(code)
      if (oldValue === newValue) continue
      const values = isFeeCode(code) ? { amount: newValue } : { rateBps: newValue }
      if (oldValue === undefined)
        tx.insert(taxSettings)
          .values({ code, ...values })
          .run()
      else tx.update(taxSettings).set(values).where(eq(taxSettings.code, code)).run()
      tx.insert(taxSettingChanges)
        .values({ code, oldValue: oldValue ?? 0, newValue, changedBy: userId, changedAt })
        .run()
    }
  })
  return { ok: true, data: getTaxSettingsView() }
}
