// The government's settings (system_settings, one row per value): the validity margin after a
// trip's estimated arrival and the average speeds the trip form suggests the arrival from, each
// per kind of trip. Edited by government admins (govt.settings); read when billing and by the form.
import { getDb, systemSettings } from '../db'
import type { FleetResult } from '@masarat/shared/fleet'
import { DEFAULT_SETTINGS, isValidSettings, type SystemSettings } from '@masarat/shared/settings'
import { TRIP_CATEGORIES } from '@masarat/shared/tax'
import type { Tx } from './companies'

type Db = ReturnType<typeof getDb> | Tx

const marginKey = (category: string): string => `validity_margin_hours.${category}`
const speedKey = (category: string): string => `average_speed_kmh.${category}`

export async function getSettings(db: Db = getDb()): Promise<SystemSettings> {
  const rows = new Map((await db.select().from(systemSettings)).map((r) => [r.key, r.value]))
  const settings = structuredClone(DEFAULT_SETTINGS)
  for (const category of TRIP_CATEGORIES) {
    settings.validityMarginHours[category] =
      rows.get(marginKey(category)) ?? settings.validityMarginHours[category]
    settings.averageSpeedKmh[category] =
      rows.get(speedKey(category)) ?? settings.averageSpeedKmh[category]
  }
  return settings
}

export async function updateSettings(input: SystemSettings): Promise<FleetResult<SystemSettings>> {
  if (!isValidSettings(input)) return { ok: false, error: 'invalid_settings' }
  const rows = TRIP_CATEGORIES.flatMap((category) => [
    { key: marginKey(category), value: input.validityMarginHours[category] },
    { key: speedKey(category), value: input.averageSpeedKmh[category] }
  ])
  await getDb().transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .insert(systemSettings)
        .values(row)
        .onConflictDoUpdate({ target: systemSettings.key, set: { value: row.value } })
    }
  })
  return { ok: true, data: await getSettings() }
}
