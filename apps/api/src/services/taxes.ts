// Tax percentages (VAT, business profit, locality), fixed fees (manifest fee) and their change
// log. Any government account can change them for the MVP; each change records who made it.
import { desc, eq } from 'drizzle-orm'
import { getDb, taxSettingChanges, taxSettings, users } from '../db'
import type { FleetResult } from '@masarat/shared/fleet'
import {
  LINE_CODES,
  MAX_FEE,
  MAX_TAX_BPS,
  isFeeCode,
  type LineCode,
  type TaxRatesInput,
  type TaxSettingsView
} from '@masarat/shared/tax'
import { getFeeSettings, getTaxSettings } from './trips'

const HISTORY_LIMIT = 20

export async function getTaxSettingsView(): Promise<TaxSettingsView> {
  const db = getDb()
  const history = await db
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
  return {
    rates: await getTaxSettings(db),
    fees: await getFeeSettings(db),
    history: history.map((change) => ({ ...change, changedAt: change.changedAt.getTime() }))
  }
}

// A tax: whole basis points from 0 to 100% (two decimals of a percent). A fee: whole SDG.
const isValidValue = (code: LineCode, value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= (isFeeCode(code) ? MAX_FEE : MAX_TAX_BPS)

export async function updateTaxRates(
  userId: number,
  input: TaxRatesInput
): Promise<FleetResult<TaxSettingsView>> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'missing_fields' }
  const changes = LINE_CODES.filter((code) => input[code] !== undefined)
  const invalid = changes.find((code) => !isValidValue(code, input[code]))
  if (invalid) return { ok: false, error: isFeeCode(invalid) ? 'invalid_fee' : 'invalid_tax_rate' }

  const db = getDb()
  await db.transaction(async (tx) => {
    // Locked so two changes at once log their old values in order
    await tx.select({ id: taxSettings.id }).from(taxSettings).for('update')
    const current = new Map<LineCode, number>([
      ...(await getTaxSettings(tx)).map((s) => [s.code, s.rateBps] as const),
      ...(await getFeeSettings(tx)).map((f) => [f.code, f.amount] as const)
    ])
    const changedAt = new Date()
    for (const code of changes) {
      const newValue = input[code] as number
      const oldValue = current.get(code)
      if (oldValue === newValue) continue
      const values = isFeeCode(code) ? { amount: newValue } : { rateBps: newValue }
      if (oldValue === undefined) await tx.insert(taxSettings).values({ code, ...values })
      else await tx.update(taxSettings).set(values).where(eq(taxSettings.code, code))
      await tx
        .insert(taxSettingChanges)
        .values({ code, oldValue: oldValue ?? 0, newValue, changedBy: userId, changedAt })
    }
  })
  return { ok: true, data: await getTaxSettingsView() }
}
