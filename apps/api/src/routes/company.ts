// A company's own administration: its details (Company), branches, roles and members (Team)
import { Hono } from 'hono'
import {
  branchSchema,
  companySchema,
  memberRoleSchema,
  newMemberSchema,
  roleSchema
} from '@masarat/shared/schemas'
import { GOVT_ROLE_KEYS, type GovtRoleKey } from '@masarat/shared/permissions'
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
import { fail, idParam, send, type AppContext, type AppEnv } from '../http/context'
import { companyId, requireCompany, userId } from '../http/company'
import { requirePermission } from '../http/middleware'
import { body, doc } from '../http/validate'

const side = (c: AppContext): Side => ({ kind: 'company', companyId: companyId(c) })

export const companyRoutes = new Hono<AppEnv>()
  .use(...requireCompany)
  .put(
    '/',
    doc('Company', 'Update the company’s details (carrier details on its manifests)'),
    requirePermission('company.profile'),
    body(companySchema, 'missing_fields'),
    async (c) => send(c, await updateCompany(companyId(c), c.req.valid('json')))
  )

export const branchRoutes = new Hono<AppEnv>()
  .use(...requireCompany)
  // Every member sees the branches (trip forms, lists and the Team section name them)
  .get('/', doc('Branches', 'The company’s branches'), async (c) =>
    send(c, { ok: true, data: await listBranches(companyId(c)) })
  )
  .post(
    '/',
    doc('Branches', 'Add a branch'),
    requirePermission('branches.manage'),
    body(branchSchema),
    async (c) => send(c, await createBranch(companyId(c), c.req.valid('json')))
  )
  .put(
    '/:id',
    doc('Branches', 'Edit, close or reopen a branch'),
    requirePermission('branches.manage'),
    body(branchSchema),
    async (c) => {
      const id = idParam(c)
      if (id === null) return fail(c, 'branch_not_found')
      return send(c, await updateBranch(companyId(c), id, c.req.valid('json')))
    }
  )

export const roleRoutes = new Hono<AppEnv>()
  .use(...requireCompany)
  // The Team section picks roles too
  .get(
    '/',
    doc('Roles', 'The company’s roles'),
    requirePermission('roles.manage', 'members.manage'),
    async (c) => send(c, { ok: true, data: await listRoles(side(c)) })
  )
  .post(
    '/',
    doc('Roles', 'Add a role'),
    requirePermission('roles.manage'),
    body(roleSchema, 'invalid_role'),
    async (c) => send(c, await createRole(companyId(c), c.req.valid('json')))
  )
  .put(
    '/:id',
    doc('Roles', 'Edit a role'),
    requirePermission('roles.manage'),
    body(roleSchema, 'invalid_role'),
    async (c) => {
      const id = idParam(c)
      if (id === null) return fail(c, 'role_not_found')
      return send(c, await updateRole(companyId(c), id, c.req.valid('json')))
    }
  )
  .delete(
    '/:id',
    doc('Roles', 'Delete a role nobody has'),
    requirePermission('roles.manage'),
    async (c) => {
      const id = idParam(c)
      return id === null ? fail(c, 'role_not_found') : send(c, await deleteRole(companyId(c), id))
    }
  )

// The Team section, and the government's Users section: the same routes on each side
export const memberRoutes = (sideOf: (c: AppContext) => Side): Hono<AppEnv> =>
  new Hono<AppEnv>()
    .get('/', doc('Members', 'The accounts'), async (c) =>
      send(c, { ok: true, data: await listMembers(sideOf(c)) })
    )
    // The roles an account can be given; the government admin is the one account created at
    // deployment, so its role isn't offered
    .get('/roles', doc('Members', 'The roles an account can be given'), async (c) => {
      const side = sideOf(c)
      const all = await listRoles(side)
      // The government's fixed roles highest first (GOVT_ROLE_KEYS)
      const rank = (key: string | null): number => GOVT_ROLE_KEYS.indexOf(key as GovtRoleKey)
      const data =
        side.kind === 'govt'
          ? all.filter((r) => r.key !== 'govt_admin').sort((a, b) => rank(a.key) - rank(b.key))
          : all
      return send(c, { ok: true, data })
    })
    .post(
      '/',
      doc('Members', 'Create an account with a temporary password'),
      body(newMemberSchema),
      async (c) => send(c, await createMember(sideOf(c), c.req.valid('json')))
    )
    .post('/:id/disable', doc('Members', 'Disable an account'), async (c) => {
      const id = idParam(c)
      return id === null
        ? fail(c, 'user_not_found')
        : send(c, await setDisabled(sideOf(c), userId(c), id, true))
    })
    .post('/:id/enable', doc('Members', 'Enable an account'), async (c) => {
      const id = idParam(c)
      return id === null
        ? fail(c, 'user_not_found')
        : send(c, await setDisabled(sideOf(c), userId(c), id, false))
    })
    .post(
      '/:id/reset-password',
      doc('Members', 'Give an account a new temporary password'),
      async (c) => {
        const id = idParam(c)
        return id === null
          ? fail(c, 'user_not_found')
          : send(c, await resetPassword(sideOf(c), userId(c), id))
      }
    )
    .put(
      '/:id/role',
      doc('Members', 'Change an account’s role or branch'),
      body(memberRoleSchema),
      async (c) => {
        const id = idParam(c)
        if (id === null) return fail(c, 'user_not_found')
        return send(c, await changeRole(sideOf(c), userId(c), id, c.req.valid('json')))
      }
    )

export const companyMemberRoutes = new Hono<AppEnv>()
  .use(...requireCompany, requirePermission('members.manage'))
  .route('/', memberRoutes(side))
