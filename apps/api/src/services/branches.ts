// A company's branches: where its clerks book trips. Often a booth at a land port, so a branch is
// just a name and a city. A closed branch keeps its trips and members but takes no new trips.
import { and, asc, count, eq } from 'drizzle-orm'
import { branches, cities, getDb, isUniqueViolation, manifests, users, type Branch } from '../db'
import {
  MAX_BRANCH_NAME_LENGTH,
  type BranchInput,
  type BranchRecord,
  type MemberResult
} from '@masarat/shared/members'
import { toBranchSummary } from './access'

const toRecord = (branch: Branch, memberCount: number, tripCount: number): BranchRecord => ({
  ...toBranchSummary(branch),
  memberCount,
  tripCount
})

export async function listBranches(companyId: number): Promise<BranchRecord[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(branches)
    .where(eq(branches.companyId, companyId))
    .orderBy(asc(branches.name))
  const members = await db
    .select({ branchId: users.branchId, value: count() })
    .from(users)
    .where(eq(users.companyId, companyId))
    .groupBy(users.branchId)
  const trips = await db
    .select({ branchId: manifests.branchId, value: count() })
    .from(manifests)
    .innerJoin(branches, eq(manifests.branchId, branches.id))
    .where(eq(branches.companyId, companyId))
    .groupBy(manifests.branchId)
  const memberCount = new Map(members.map((m) => [m.branchId, m.value]))
  const tripCount = new Map(trips.map((t) => [t.branchId, t.value]))
  return rows.map((b) => toRecord(b, memberCount.get(b.id) ?? 0, tripCount.get(b.id) ?? 0))
}

async function validate(
  input: BranchInput
): Promise<
  | { ok: true; name: string; cityId: number }
  | { ok: false; error: 'missing_fields' | 'city_not_found' }
> {
  const name = typeof input?.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > MAX_BRANCH_NAME_LENGTH) return { ok: false, error: 'missing_fields' }
  const cityId = Number(input?.cityId)
  const [city] = Number.isInteger(cityId)
    ? await getDb().select({ id: cities.id }).from(cities).where(eq(cities.id, cityId)).limit(1)
    : []
  if (!city) return { ok: false, error: 'city_not_found' }
  return { ok: true, name, cityId }
}

const isNameTaken = (error: unknown): boolean =>
  isUniqueViolation(error, 'branches_company_name_idx')

export async function createBranch(
  companyId: number,
  input: BranchInput
): Promise<MemberResult<BranchRecord>> {
  const checked = await validate(input)
  if (!checked.ok) return checked
  try {
    const [created] = await getDb()
      .insert(branches)
      .values({ companyId, name: checked.name, cityId: checked.cityId })
      .returning()
    return { ok: true, data: toRecord(created, 0, 0) }
  } catch (error) {
    if (isNameTaken(error)) return { ok: false, error: 'branch_name_taken' }
    throw error
  }
}

export async function updateBranch(
  companyId: number,
  branchId: number,
  input: BranchInput
): Promise<MemberResult<BranchRecord>> {
  const checked = await validate(input)
  if (!checked.ok) return checked
  try {
    const [updated] = await getDb()
      .update(branches)
      .set({
        name: checked.name,
        cityId: checked.cityId,
        ...(typeof input.active === 'boolean' ? { active: input.active } : {})
      })
      .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)))
      .returning()
    if (!updated) return { ok: false, error: 'branch_not_found' }
    const record = (await listBranches(companyId)).find((b) => b.id === branchId)!
    return { ok: true, data: record }
  } catch (error) {
    if (isNameTaken(error)) return { ok: false, error: 'branch_name_taken' }
    throw error
  }
}
