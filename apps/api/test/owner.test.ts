// The company portal's routes: vehicles, drivers, trips (paged), billing, attachments, and what
// each role and branch may see and do
import { beforeEach, describe, expect, test } from 'bun:test'
import { getDb, manifests } from '../src/db'
import { browser, resetData, signedIn, type Browser } from './helpers'

// Trips list periods around the fixtures' dates (the list shows one period at a time)
const TWO = 'from=2026-10-01&to=2026-11-30'
const NOV = 'from=2026-11-01&to=2026-11-30'

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a])

const OWNER = {
  fullName: 'Owner',
  companyName: 'Nile Test',
  address: 'Khartoum',
  tin: '300123'
}

interface Ids {
  vehicleId: number
  driverId: number
  branchId: number
  cities: Record<string, number>
}

async function setup(b: Browser): Promise<Ids> {
  const vehicle = await b.call('POST', '/vehicles', {
    plateNumber: 'KH 12/34567',
    registrationNo: 'R-1',
    vehicleType: 'heavy_duty_truck',
    capacity: 30,
    capacityUnit: 'ton'
  })
  const driver = await b.call('POST', '/drivers', { name: 'Ahmed Ali', phone: '0912345678' })
  return { vehicleId: vehicle.body.data.id, driverId: driver.body.data.id, ...(await context(b)) }
}

// The company's first branch, and the cities by name
async function context(b: Browser): Promise<{ branchId: number; cities: Record<string, number> }> {
  const reference = await b.call('GET', '/trips/reference')
  const cities = Object.fromEntries(
    reference.body.data.cities.map((c: { name: string; id: number }) => [c.name, c.id])
  )
  const branches = await b.call('GET', '/branches')
  return { branchId: branches.body.data[0].id, cities }
}

function tripInput(ids: Ids, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    branchId: ids.branchId,
    vehicleId: ids.vehicleId,
    originCityId: ids.cities.Khartoum,
    destinationCityId: ids.cities['Port Sudan'],
    items: [
      {
        name: 'Cement',
        quantity: 20,
        unit: 'ton',
        cargoType: 'general_cargo',
        packingType: 'Bags',
        packageCount: 400,
        notes: null
      }
    ],
    departureAt: '2026-11-20T08:00',
    arrivalAt: '2026-11-21T02:00',
    tripKind: 'domestic',
    trailers: [],
    driverId: ids.driverId,
    shipper: { name: 'Sender Co', address: 'Khartoum', phone: '0911111111' },
    receiver: { name: 'Receiver Co', address: 'Port Sudan', phone: '0922222222' },
    ...overrides
  }
}

async function upload(
  b: Browser,
  bytes: Uint8Array,
  name: string,
  docType = 'commercial_invoice'
): ReturnType<Browser['call']> {
  const form = new FormData()
  form.set('docType', docType)
  form.set('file', new File([bytes], name))
  return b.call('POST', '/documents', form)
}

beforeEach(resetData)

describe('access', () => {
  test('company routes need a company session', async () => {
    const { b: govt } = await signedIn('govt.one', 'govt_admin')
    expect((await govt.call('GET', '/vehicles')).status).toBe(403)
    const { b: anon } = { b: (await import('./helpers')).browser() }
    expect((await anon.call('GET', '/trips')).status).toBe(401)
  })

  test("another company's vehicles, trips and files are not found", async () => {
    const { b } = await signedIn('owner.one', 'company_admin', OWNER)
    const ids = await setup(b)
    const trip = await b.call('POST', '/trips', tripInput(ids))
    const { b: other } = await signedIn('owner.two', 'company_admin')
    // A well-formed edit still finds nothing: the vehicle isn't theirs
    const edit = {
      plateNumber: 'KH 1/1',
      registrationNo: 'R-1',
      vehicleType: 'lorry',
      capacity: 10,
      capacityUnit: 'ton'
    }
    expect((await other.call('PUT', `/vehicles/${ids.vehicleId}`, edit)).status).toBe(404)
    expect((await other.call('GET', `/trips/${trip.body.data.id}`)).status).toBe(404)
    expect((await other.call('POST', `/trips/${trip.body.data.id}/bill`)).status).toBe(404)
    expect((await other.call('GET', `/trips?${NOV}`)).body.data.total).toBe(0)
  })
})

describe('trip to certificate', () => {
  test('draft, bill, pay (demo), refresh', async () => {
    const { b } = await signedIn('owner.one', 'company_admin', OWNER)
    const ids = await setup(b)
    const created = await b.call('POST', '/trips', tripInput(ids))
    expect(created.status).toBe(200)
    const id = created.body.data.id

    const billed = await b.call('POST', `/trips/${id}/bill`)
    expect(billed.body.data.trip.status).toBe('billed')
    expect((await b.call('POST', `/trips/${id}/simulate-payment`)).status).toBe(200)
    const paid = await b.call('POST', `/trips/${id}/refresh`)
    expect(paid.body.data.trip.status).toBe('certified')
    expect(paid.body.data.certificate.manifestNo).toMatch(/^MNF-/)
    expect((await b.call('DELETE', `/trips/${id}`)).body.error).toBe('not_draft')
  })
})

describe('demo-only actions', () => {
  test('paying a bill is refused outside demo mode', async () => {
    const { config } = await import('../src/config')
    const { b } = await signedIn('owner.one', 'company_admin', OWNER)
    const ids = await setup(b)
    const { id } = (await b.call('POST', '/trips', tripInput(ids))).body.data
    await b.call('POST', `/trips/${id}/bill`)
    config.demoMode = false
    try {
      expect((await b.call('POST', `/trips/${id}/simulate-payment`)).status).toBe(403)
    } finally {
      config.demoMode = true
    }
  })
})

describe('attachments', () => {
  test('upload, save with the trip, preview; other owners and fakes are refused', async () => {
    const { b } = await signedIn('owner.one', 'company_admin', OWNER)
    const ids = await setup(b)
    const staged = await upload(b, PDF, 'فاتورة.pdf')
    expect(staged.status).toBe(200)
    const token = staged.body.data.token

    // A file that isn't what its name says
    expect((await upload(b, new Uint8Array([1, 2, 3, 4]), 'fake.pdf')).body.error).toBe(
      'invalid_document'
    )
    // Another owner can't attach this upload
    const { b: other } = await signedIn('owner.two', 'company_admin')
    const otherIds = await setup2(other)
    const stolen = await other.call(
      'POST',
      '/trips',
      tripInput(otherIds, { documents: [{ docType: 'commercial_invoice', token }] })
    )
    expect(stolen.body.error).toBe('invalid_document')

    const created = await b.call(
      'POST',
      '/trips',
      tripInput(ids, { documents: [{ docType: 'commercial_invoice', token }] })
    )
    const [document] = created.body.data.documents
    expect(document.fileName).toBe('فاتورة.pdf')

    const file = await b.call('GET', `/documents/${document.id}/file`)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-type')).toBe('application/pdf')
    expect(file.headers.get('content-disposition')).toStartWith('inline;')
    expect(new Uint8Array(file.body)).toEqual(PDF)
    expect((await other.call('GET', `/documents/${document.id}/file`)).status).toBe(404)
  }, 20_000)
})

// A second owner's vehicle and driver, with a plate of their own
async function setup2(b: Browser): Promise<Ids> {
  const vehicle = await b.call('POST', '/vehicles', {
    plateNumber: 'RS 3/111',
    registrationNo: 'R-2',
    vehicleType: 'heavy_duty_truck',
    capacity: 30,
    capacityUnit: 'ton'
  })
  const driver = await b.call('POST', '/drivers', { name: 'Omer', phone: '0913333333' })
  return { vehicleId: vehicle.body.data.id, driverId: driver.body.data.id, ...(await context(b)) }
}

describe('paged trips list', () => {
  test('pages, totals, filters, search and groups across pages', async () => {
    const { b } = await signedIn('owner.one', 'company_admin', OWNER)
    const ids = await setup(b)
    // 30 trips over two months, every third one to Kassala
    for (let i = 0; i < 30; i++) {
      const day =
        i < 12
          ? `2026-10-${String(i + 1).padStart(2, '0')}`
          : `2026-11-${String(i - 11).padStart(2, '0')}`
      const res = await b.call(
        'POST',
        '/trips',
        tripInput(ids, {
          departureAt: `${day}T08:00`,
          arrivalAt: `${day}T20:00`,
          destinationCityId: i % 3 === 0 ? ids.cities.Kassala : ids.cities['Port Sudan']
        })
      )
      expect(res.status).toBe(200)
    }

    const first = await b.call('GET', `/trips?${TWO}&pageSize=25&sort=departureAt&direction=desc`)
    expect(first.body.data).toMatchObject({ total: 30, overall: 30, page: 1, pageSize: 25 })
    expect(first.body.data.rows).toHaveLength(25)
    const second = await b.call(
      'GET',
      `/trips?${TWO}&pageSize=25&page=2&sort=departureAt&direction=desc`
    )
    expect(second.body.data.rows).toHaveLength(5)
    // Newest first, and no trip on both pages
    const dates = [...first.body.data.rows, ...second.body.data.rows].map(
      (t: { departureAt: number }) => t.departureAt
    )
    expect(dates).toEqual([...dates].sort((a, b) => b - a))
    const allIds = new Set(
      [...first.body.data.rows, ...second.body.data.rows].map((t: { id: number }) => t.id)
    )
    expect(allIds.size).toBe(30)

    const kassala = await b.call('GET', `/trips?${TWO}&query=kassala`)
    expect(kassala.body.data).toMatchObject({ total: 10, overall: 30 })
    const october = await b.call('GET', '/trips?from=2026-10-01&to=2026-10-31')
    expect(october.body.data.total).toBe(12)

    // Grouped by month across pages: page 1 holds November (18) and part of October
    const grouped = await b.call('GET', `/trips?${TWO}&pageSize=25&group=month`)
    const groups = grouped.body.data.groups
    expect(groups.map((g: { key: string }) => g.key)).toEqual(['2026-11', '2026-10'])
    expect(groups.map((g: { count: number }) => g.count)).toEqual([18, 12])
    // Each group's total is its trips' amounts, from every page
    const due = async (from: string, to: string): Promise<number> => {
      const month = await b.call('GET', `/trips?from=${from}&to=${to}&pageSize=100`)
      return month.body.data.rows.reduce(
        (sum: number, t: { taxAmount: number }) => sum + t.taxAmount,
        0
      )
    }
    expect(groups[0].totalDue).toBe(await due('2026-11-01', '2026-11-30'))
    expect(grouped.body.data.rows[0].groupKey).toBe('2026-11')
    const page2 = await b.call('GET', `/trips?${TWO}&pageSize=25&page=2&group=month`)
    expect(page2.body.data.groups).toEqual([
      { key: '2026-10', count: 12, totalDue: await due('2026-10-01', '2026-10-31') }
    ])

    const [{ count }] = [{ count: await getDb().$count(manifests) }]
    expect(count).toBe(30)
  }, 60_000)

  test('shows one period at a time: the current month by default, at most 92 days', async () => {
    const { b } = await signedIn('owner.one', 'company_admin', OWNER)
    const ids = await setup(b)
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    await b.call(
      'POST',
      '/trips',
      tripInput(ids, { departureAt: `${today}T08:00`, arrivalAt: `${today}T20:00` })
    )
    await b.call(
      'POST',
      '/trips',
      tripInput(ids, { departureAt: '2025-01-10T08:00', arrivalAt: '2025-01-10T20:00' })
    )
    const current = await b.call('GET', '/trips')
    expect(current.body.data).toMatchObject({ total: 1, overall: 1 })
    expect(current.body.data.period.from).toBe(`${today.slice(0, 8)}01`)
    const january = await b.call('GET', '/trips?from=2025-01-01&to=2025-01-31')
    expect(january.body.data).toMatchObject({
      total: 1,
      period: { from: '2025-01-01', to: '2025-01-31' }
    })
    expect((await b.call('GET', '/trips?from=2025-01-01&to=2025-04-30')).body.error).toBe(
      'invalid_period'
    )
    expect((await b.call('GET', '/trips?from=2025-02-01&to=2025-01-01')).body.error).toBe(
      'invalid_period'
    )
  })

  test('finds whole names only, whatever their Arabic spelling', async () => {
    const { b } = await signedIn('owner.one', 'company_admin', OWNER)
    const ids = await setup(b)
    const trip = await b.call(
      'POST',
      '/trips',
      tripInput(ids, { shipper: { name: 'أحمد علي', address: 'الخرطوم', phone: '0912345670' } })
    )
    expect(trip.status).toBe(200)
    const found = async (query: string): Promise<number> =>
      (await b.call('GET', `/trips?${NOV}&query=${encodeURIComponent(query)}`)).body.data.total
    expect(await found('احمد علي')).toBe(1)
    expect(await found('  أحمدُ   علي ')).toBe(1)
    // Part of a name finds nothing
    expect(await found('احمد')).toBe(0)
    expect(await found('علي')).toBe(0)
    // The trip number, whole
    expect(await found(`#${trip.body.data.id}`)).toBe(1)
  })

  test('a page past the end shows the last page', async () => {
    const { b } = await signedIn('owner.one', 'company_admin', OWNER)
    const ids = await setup(b)
    await b.call('POST', '/trips', tripInput(ids))
    const result = await b.call('GET', `/trips?${NOV}&page=9`)
    expect(result.body.data).toMatchObject({ page: 1, total: 1 })
  })
})

describe('branches and roles', () => {
  // A company with two branches, its admin, and a clerk at each branch
  async function company(): Promise<{
    admin: Browser
    clerk1: Browser
    clerk2: Browser
    ids: Ids
    branch2: number
    companyId: number
  }> {
    const { b: admin, companyId } = await signedIn('owner.one', 'company_admin', OWNER)
    const ids = await setup(admin)
    const second = await admin.call('POST', '/branches', {
      name: 'Port office',
      cityId: ids.cities['Port Sudan']
    })
    expect(second.status).toBe(200)
    const branch2 = second.body.data.id
    const clerk1 = (await signedIn('clerk.one', 'clerk', { companyId: companyId! })).b
    const clerk2 = (
      await signedIn('clerk.two', 'clerk', { companyId: companyId!, branchId: branch2 })
    ).b
    return { admin, clerk1, clerk2, ids, branch2, companyId: companyId! }
  }

  test('a clerk books at their own branch and sees only its trips', async () => {
    const { admin, clerk1, clerk2, ids, branch2 } = await company()
    // The admin picks the branch; without one there's nothing to book at
    expect(
      (await admin.call('POST', '/trips', tripInput(ids, { branchId: null }))).body.error
    ).toBe('branch_required')
    const atBranch2 = await admin.call('POST', '/trips', tripInput(ids, { branchId: branch2 }))
    expect(atBranch2.body.data.branchId).toBe(branch2)

    // Clerk 1's trip is at their branch, whatever the request says
    const own = await clerk1.call('POST', '/trips', tripInput(ids, { branchId: branch2 }))
    expect(own.body.data.branchId).toBe(ids.branchId)

    expect((await clerk1.call('GET', `/trips?${NOV}`)).body.data).toMatchObject({
      total: 1,
      overall: 1
    })
    expect((await clerk2.call('GET', `/trips?${NOV}`)).body.data.total).toBe(1)
    expect((await admin.call('GET', `/trips?${NOV}`)).body.data.total).toBe(2)
    expect((await clerk1.call('GET', `/trips/${atBranch2.body.data.id}`)).status).toBe(404)
    expect((await clerk1.call('POST', `/trips/${atBranch2.body.data.id}/bill`)).status).toBe(404)
    const branchFilter = await admin.call('GET', `/trips?${NOV}&branchId=${branch2}&group=branch`)
    expect(branchFilter.body.data.groups).toEqual([
      expect.objectContaining({ key: String(branch2), count: 1 })
    ])

    // Clerks see vehicles and drivers for the form, but can't change them or the company
    expect((await clerk1.call('GET', '/vehicles')).status).toBe(200)
    expect((await clerk1.call('DELETE', `/vehicles/${ids.vehicleId}`)).status).toBe(403)
    expect((await clerk1.call('GET', '/members')).status).toBe(403)
    expect((await clerk1.call('PUT', '/company', { name: 'X' })).status).toBe(403)

    // A closed branch takes no new trips
    await admin.call('PUT', `/branches/${ids.branchId}`, {
      name: 'Main office',
      cityId: ids.cities.Khartoum,
      active: false
    })
    expect((await clerk1.call('POST', '/trips', tripInput(ids))).body.error).toBe('branch_inactive')
  }, 30_000)

  test("a custom role's checkboxes take effect at once", async () => {
    const { admin, ids } = await company()
    const role = await admin.call('POST', '/roles', {
      name: 'Dispatcher',
      scope: 'company',
      permissions: ['trips.view']
    })
    expect(role.body.data).toMatchObject({ locked: false, permissions: ['trips.view'] })
    const created = await admin.call('POST', '/members', {
      username: 'dispatch',
      fullName: 'Dispatcher',
      phone: '0915550000',
      roleId: role.body.data.id
    })
    expect(created.status).toBe(200)
    const dispatcher = browser('http://localhost:5173')
    const { temporaryPassword } = created.body.data
    await dispatcher.call('POST', '/auth/login', {
      username: 'dispatch',
      password: temporaryPassword
    })
    await dispatcher.call('POST', '/auth/change-password', {
      currentPassword: temporaryPassword,
      newPassword: 'another-horse'
    })
    expect((await dispatcher.call('GET', '/trips')).status).toBe(200)
    expect((await dispatcher.call('POST', '/trips', tripInput(ids))).status).toBe(403)

    // Ticking "edit" also ticks "view"; the dispatcher can book on their next request
    const updated = await admin.call('PUT', `/roles/${role.body.data.id}`, {
      name: 'Dispatcher',
      scope: 'company',
      permissions: ['trips.edit']
    })
    expect(updated.body.data.permissions).toEqual(['trips.view', 'trips.edit'])
    expect((await dispatcher.call('POST', '/trips', tripInput(ids))).status).toBe(200)

    // A role in use can't be deleted or change scope; the built-in admin role can't be edited
    expect((await admin.call('DELETE', `/roles/${role.body.data.id}`)).body.error).toBe(
      'role_in_use'
    )
    expect(
      (
        await admin.call('PUT', `/roles/${role.body.data.id}`, {
          name: 'Dispatcher',
          scope: 'branch',
          permissions: ['trips.edit']
        })
      ).body.error
    ).toBe('role_in_use')
    const roles = (await admin.call('GET', '/roles')).body.data
    const adminRole = roles.find((r: { key: string }) => r.key === 'company_admin')
    expect(
      (
        await admin.call('PUT', `/roles/${adminRole.id}`, {
          name: 'x',
          scope: 'company',
          permissions: ['trips.view']
        })
      ).body.error
    ).toBe('role_locked')
    // Only the company's own permissions can be ticked
    expect(
      (
        await admin.call('POST', '/roles', {
          name: 'Spy',
          scope: 'company',
          permissions: ['govt.users']
        })
      ).body.error
    ).toBe('invalid_role')
  }, 30_000)

  test('team: branch roles need a branch, and the last admin stays', async () => {
    const { admin, companyId } = await company()
    const roles = (await admin.call('GET', '/roles')).body.data
    const roleId = (key: string): number => roles.find((r: { key: string }) => r.key === key).id
    const noBranch = await admin.call('POST', '/members', {
      username: 'clerk.three',
      fullName: 'Clerk',
      phone: '0915550001',
      roleId: roleId('clerk')
    })
    expect(noBranch.body.error).toBe('branch_required')
    // Another company's role isn't found
    const { b: other } = await signedIn('owner.two', 'company_admin')
    const otherRoles = (await other.call('GET', '/roles')).body.data
    expect(
      (
        await admin.call('POST', '/members', {
          username: 'clerk.three',
          fullName: 'Clerk',
          phone: '0915550001',
          roleId: otherRoles[0].id
        })
      ).body.error
    ).toBe('role_not_found')

    const team = (await admin.call('GET', '/members')).body.data
    expect(team).toHaveLength(3)
    const me = team.find((m: { username: string }) => m.username === 'owner.one')
    expect((await admin.call('POST', `/members/${me.id}/disable`)).body.error).toBe(
      'cannot_change_self'
    )
    // Another admin may demote the first, since an admin remains; the demoted one loses Team
    const { b: deputy } = await signedIn('deputy', 'company_admin', { companyId })
    const deputyId = (await deputy.call('GET', '/auth/me')).body.user.id
    expect(
      (await deputy.call('PUT', `/members/${me.id}/role`, { roleId: roleId('accountant') })).status
    ).toBe(200)
    expect(
      (await admin.call('PUT', `/members/${deputyId}/role`, { roleId: roleId('accountant') }))
        .status
    ).toBe(403)
    expect((await deputy.call('GET', '/members')).body.data).toHaveLength(4)
    const clerk = team.find((m: { username: string }) => m.username === 'clerk.one')
    expect(
      (await deputy.call('PUT', `/members/${clerk.id}/role`, { roleId: roleId('company_admin') }))
        .body.data.role.key
    ).toBe('company_admin')
  }, 30_000)
})
