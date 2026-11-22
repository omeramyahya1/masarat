// A company's own administration: its details (Company), branches, roles and members (Team)
import { Hono } from 'hono'
import type { CompanyInput } from '@masarat/shared/auth'
import type {
  BranchInput,
  MemberRoleInput,
  NewMemberInput,
  RoleInput
} from '@masarat/shared/members'
import { createBranch, listBranches, updateBranch } from '../services/branches'
import { updateCompany } from '../services/companies'
import {
  changeRole,
  createMember,
  listMembers,
  resetPassword,
  setDisabled,
  type Side
} from '../services/members'
import { createRole, deleteRole, listRoles, updateRole } from '../services/roles'
import { fail, idParam, readJson, send, type AppContext, type AppEnv } from '../http/context'
import { companyId, requireCompany, userId } from '../http/company'
import { requirePermission } from '../http/middleware'

const side = (c: AppContext): Side => ({ kind: 'company', companyId: companyId(c) })

export const companyRoutes = new Hono<AppEnv>()
  .use(...requireCompany)
  .put('/', requirePermission('company.profile'), async (c) =>
    send(c, await updateCompany(companyId(c), (await readJson(c)) as unknown as CompanyInput))
  )

export const branchRoutes = new Hono<AppEnv>()
  .use(...requireCompany)
  // Every member sees the branches (trip forms, lists and the Team section name them)
  .get('/', async (c) => send(c, { ok: true, data: await listBranches(companyId(c)) }))
  .post('/', requirePermission('branches.manage'), async (c) =>
    send(c, await createBranch(companyId(c), (await readJson(c)) as unknown as BranchInput))
  )
  .put('/:id', requirePermission('branches.manage'), async (c) => {
    const id = idParam(c)
    if (id === null) return fail(c, 'branch_not_found')
    return send(
      c,
      await updateBranch(companyId(c), id, (await readJson(c)) as unknown as BranchInput)
    )
  })

export const roleRoutes = new Hono<AppEnv>()
  .use(...requireCompany)
  // The Team section picks roles too
  .get('/', requirePermission('roles.manage', 'members.manage'), async (c) =>
    send(c, { ok: true, data: await listRoles(side(c)) })
  )
  .post('/', requirePermission('roles.manage'), async (c) =>
    send(c, await createRole(companyId(c), (await readJson(c)) as unknown as RoleInput))
  )
  .put('/:id', requirePermission('roles.manage'), async (c) => {
    const id = idParam(c)
    if (id === null) return fail(c, 'role_not_found')
    return send(c, await updateRole(companyId(c), id, (await readJson(c)) as unknown as RoleInput))
  })
  .delete('/:id', requirePermission('roles.manage'), async (c) => {
    const id = idParam(c)
    return id === null ? fail(c, 'role_not_found') : send(c, await deleteRole(companyId(c), id))
  })

// The Team section, and the government's Users section: the same routes on each side
export const memberRoutes = (sideOf: (c: AppContext) => Side): Hono<AppEnv> =>
  new Hono<AppEnv>()
    .get('/', async (c) => send(c, { ok: true, data: await listMembers(sideOf(c)) }))
    .get('/roles', async (c) => send(c, { ok: true, data: await listRoles(sideOf(c)) }))
    .post('/', async (c) =>
      send(c, await createMember(sideOf(c), (await readJson(c)) as unknown as NewMemberInput))
    )
    .post('/:id/disable', async (c) => {
      const id = idParam(c)
      return id === null
        ? fail(c, 'user_not_found')
        : send(c, await setDisabled(sideOf(c), userId(c), id, true))
    })
    .post('/:id/enable', async (c) => {
      const id = idParam(c)
      return id === null
        ? fail(c, 'user_not_found')
        : send(c, await setDisabled(sideOf(c), userId(c), id, false))
    })
    .post('/:id/reset-password', async (c) => {
      const id = idParam(c)
      return id === null
        ? fail(c, 'user_not_found')
        : send(c, await resetPassword(sideOf(c), userId(c), id))
    })
    .put('/:id/role', async (c) => {
      const id = idParam(c)
      if (id === null) return fail(c, 'user_not_found')
      const input = (await readJson(c)) as unknown as MemberRoleInput
      return send(c, await changeRole(sideOf(c), userId(c), id, input))
    })

export const companyMemberRoutes = new Hono<AppEnv>()
  .use(...requireCompany, requirePermission('members.manage'))
  .route('/', memberRoutes(side))
