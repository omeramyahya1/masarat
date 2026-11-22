// Transport companies: creating one (sign-up and the demo data) with its built-in roles, and the
// company admin editing its details
import { eq } from 'drizzle-orm'
import { companies, getDb, rolePermissions, roles, type Company } from '../db'
import {
  MAX_ADDRESS_LENGTH,
  MAX_TIN_LENGTH,
  type AuthErrorCode,
  type CompanyInput,
  type CompanyProfile
} from '@masarat/shared/auth'
import { BUILTIN_ROLES, COMPANY_ROLE_KEYS } from '@masarat/shared/permissions'
import { toCompanyProfile } from './access'

export type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]
type Db = ReturnType<typeof getDb> | Tx

// Built-in role names as stored; the portals show them translated by key
const ROLE_NAMES = {
  company_admin: 'Company admin',
  clerk: 'Clerk',
  accountant: 'Accountant'
} as const

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

// The carrier details: address and TIN may be empty, but are limited in length
export function checkCarrierDetails(address: string, tin: string): AuthErrorCode | null {
  if (address.length > MAX_ADDRESS_LENGTH) return 'address_too_long'
  if (tin.length > MAX_TIN_LENGTH) return 'invalid_tin'
  return null
}

// A new company with its three built-in roles; returns the company and its admin role's id
export async function createCompany(
  db: Db,
  values: { name: string; address: string | null; tin: string | null; isDemo?: boolean }
): Promise<{ company: Company; adminRoleId: number }> {
  const [company] = await db.insert(companies).values(values).returning()
  const created = await db
    .insert(roles)
    .values(
      COMPANY_ROLE_KEYS.map((key) => ({
        companyId: company.id,
        key,
        name: ROLE_NAMES[key],
        scope: BUILTIN_ROLES[key].scope
      }))
    )
    .returning()
  // The clerk and accountant start with their defaults and can be edited; the company admin's
  // permissions come from the code
  const editable = created.filter((role) => role.key !== 'company_admin')
  await db
    .insert(rolePermissions)
    .values(
      editable.flatMap((role) =>
        BUILTIN_ROLES[role.key!].permissions.map((permission) => ({ roleId: role.id, permission }))
      )
    )
  const admin = created.find((role) => role.key === 'company_admin')!
  return { company, adminRoleId: admin.id }
}

export type CompanyResult = { ok: true; data: CompanyProfile } | { ok: false; error: AuthErrorCode }

export async function updateCompany(
  companyId: number,
  input: CompanyInput
): Promise<CompanyResult> {
  const name = asText(input?.name)
  if (!name) return { ok: false, error: 'missing_fields' }
  const address = asText(input?.address)
  const tin = asText(input?.tin)
  const carrierError = checkCarrierDetails(address, tin)
  if (carrierError) return { ok: false, error: carrierError }
  const [updated] = await getDb()
    .update(companies)
    .set({ name, address: address || null, tin: tin || null })
    .where(eq(companies.id, companyId))
    .returning()
  if (!updated) return { ok: false, error: 'not_signed_in' }
  return { ok: true, data: toCompanyProfile(updated) }
}
