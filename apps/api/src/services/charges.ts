// The taxes and fees ("charges") and their change log. The government admin (govt.charges)
// changes their values per kind of trip, renames them, switches them on or off, and adds custom
// ones; the four built-in ones can't be removed. A bill freezes the lines it was issued with
// (manifest_charges), so none of this changes bills already issued.
import { randomBytes } from 'crypto'
import { asc, desc, eq } from 'drizzle-orm'
import { chargeChanges, charges, getDb, users, type Charge } from '../db'
import type { FleetResult } from '@masarat/shared/fleet'
import {
  CHARGE_KINDS,
  MAX_CHARGE_NAME_LENGTH,
  isChargeValue,
  type ChargeField,
  type ChargeInput,
  type ChargeKind,
  type ChargeRecord,
  type ChargesView
} from '@masarat/shared/tax'
import type { Tx } from './companies'

type Db = ReturnType<typeof getDb> | Tx

const HISTORY_LIMIT = 30

export const toChargeRecord = (charge: Charge): ChargeRecord => ({
  id: charge.id,
  code: charge.code,
  name: charge.name,
  nameAr: charge.nameAr,
  kind: charge.kind,
  cargoValue: charge.cargoValue,
  passengerValue: charge.passengerValue,
  active: charge.active,
  builtin: charge.builtin
})

// Every charge in billing order (percentages first, see calculateCharges), switched off ones too
export async function listCharges(db: Db = getDb()): Promise<ChargeRecord[]> {
  const rows = await db.select().from(charges).orderBy(asc(charges.sort), asc(charges.id))
  return rows.map(toChargeRecord)
}

export async function getChargesView(): Promise<ChargesView> {
  const db = getDb()
  const history = await db
    .select({
      chargeId: chargeChanges.chargeId,
      name: charges.name,
      nameAr: charges.nameAr,
      kind: charges.kind,
      field: chargeChanges.field,
      oldValue: chargeChanges.oldValue,
      newValue: chargeChanges.newValue,
      changedBy: users.fullName,
      changedAt: chargeChanges.changedAt
    })
    .from(chargeChanges)
    .innerJoin(charges, eq(chargeChanges.chargeId, charges.id))
    .innerJoin(users, eq(chargeChanges.changedBy, users.id))
    .orderBy(desc(chargeChanges.changedAt), desc(chargeChanges.id))
    .limit(HISTORY_LIMIT)
  return {
    charges: await listCharges(db),
    history: history.map((change) => ({ ...change, changedAt: change.changedAt.getTime() }))
  }
}

type Checked = Omit<ChargeInput, 'kind'>

// Input comes from the browser, so treat every field as untrusted
function validate(input: ChargeInput, kind: ChargeKind): FleetResult<Checked> {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  const nameAr = typeof input?.nameAr === 'string' ? input.nameAr.trim() : ''
  if (!name || !nameAr) return { ok: false, error: 'missing_fields' }
  if (name.length > MAX_CHARGE_NAME_LENGTH || nameAr.length > MAX_CHARGE_NAME_LENGTH) {
    return { ok: false, error: 'invalid_charge' }
  }
  const invalidValue = kind === 'percent' ? 'invalid_tax_rate' : 'invalid_fee'
  for (const value of [input.cargoValue, input.passengerValue]) {
    if (value !== null && !isChargeValue(kind, value)) return { ok: false, error: invalidValue }
  }
  // A charge that applies to no kind of trip would never be billed
  if (input.cargoValue === null && input.passengerValue === null) {
    return { ok: false, error: 'invalid_charge' }
  }
  if (typeof input.active !== 'boolean') return { ok: false, error: 'missing_fields' }
  const { cargoValue, passengerValue, active } = input
  return { ok: true, data: { name, nameAr, cargoValue, passengerValue, active } }
}

const asText = (value: string | number | boolean | null): string | null =>
  value === null ? null : String(value)

const FIELDS: (keyof Checked & ChargeField)[] = [
  'name',
  'nameAr',
  'cargoValue',
  'passengerValue',
  'active'
]

export async function createCharge(
  userId: number,
  input: ChargeInput
): Promise<FleetResult<ChargesView>> {
  const kind = input?.kind
  if (!CHARGE_KINDS.includes(kind)) return { ok: false, error: 'invalid_charge' }
  const checked = validate(input, kind)
  if (!checked.ok) return checked
  await getDb().transaction(async (tx) => {
    // Custom ones go after the built-in ones of their kind
    const [{ value: sort }] = await tx
      .select({ value: charges.sort })
      .from(charges)
      .orderBy(desc(charges.sort))
      .limit(1)
      .then((rows) => (rows.length ? rows : [{ value: 0 }]))
    const [created] = await tx
      .insert(charges)
      // The code needs the id: a placeholder first
      .values({
        ...checked.data,
        kind,
        code: `new_${randomBytes(8).toString('hex')}`,
        sort: sort + 1
      })
      .returning()
    await tx
      .update(charges)
      .set({ code: `custom_${created.id}` })
      .where(eq(charges.id, created.id))
    await tx.insert(chargeChanges).values({
      chargeId: created.id,
      field: 'created',
      oldValue: null,
      newValue: `${created.name} / ${created.nameAr}`,
      changedBy: userId
    })
  })
  return { ok: true, data: await getChargesView() }
}

export async function updateCharge(
  userId: number,
  chargeId: number,
  input: ChargeInput
): Promise<FleetResult<ChargesView>> {
  const result = await getDb().transaction(async (tx): Promise<FleetResult<null>> => {
    // Locked so two admins' changes log their old values in order
    const [current] = await tx.select().from(charges).where(eq(charges.id, chargeId)).for('update')
    if (!current) return { ok: false, error: 'charge_not_found' }
    const checked = validate(input, current.kind)
    if (!checked.ok) return checked
    const changed = FIELDS.filter((field) => checked.data[field] !== current[field])
    if (changed.length === 0) return { ok: true, data: null }
    await tx.update(charges).set(checked.data).where(eq(charges.id, chargeId))
    const changedAt = new Date()
    await tx.insert(chargeChanges).values(
      changed.map((field) => ({
        chargeId,
        field,
        oldValue: asText(current[field]),
        newValue: asText(checked.data[field]),
        changedBy: userId,
        changedAt
      }))
    )
    return { ok: true, data: null }
  })
  return result.ok ? { ok: true, data: await getChargesView() } : result
}
