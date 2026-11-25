import { and, eq, isNull, sql } from 'drizzle-orm'
import { branches, cities, getDb, roles, users } from '../src/db'

// Empties every table except the reference data the migrations seeded (the government's roles
// among it)
export async function resetData(): Promise<void> {
  await getDb().execute(sql`
    truncate sessions, login_attempts, esali_sim_bills, certificates, payments, manifest_charges,
      trip_documents, manifest_trailers, manifest_cargo_items, manifests, vehicles, drivers,
      charge_changes, daily_revenue, people, users restart identity cascade
  `)
  await getDb().execute(sql`delete from roles where company_id is not null`)
  await getDb().execute(sql`delete from branches`)
  await getDb().execute(sql`delete from companies`)
  // Back to the four built-in charges as seeded
  await getDb().execute(sql`delete from charges where not builtin`)
  await getDb().execute(sql`
    update charges set active = true,
      cargo_value = d.value, passenger_value = d.value, name = d.name, name_ar = d.name_ar
    from (values
      ('vat', 1700, 'Value added tax', 'ضريبة القيمة المضافة'),
      ('business_profit', 300, 'Business profit tax', 'ضريبة أرباح الأعمال'),
      ('locality', 200, 'Locality tax', 'الضريبة المحلية'),
      ('manifest_fee', 1500, 'Manifest fee', 'رسوم المنفيست')
    ) as d(code, value, name, name_ar)
    where charges.code = d.code
  `)
}

// A different Sudanese mobile number for every account a test creates (phones are unique)
let phoneCounter = 0
export const nextPhone = (): string => `+24991${String(++phoneCounter).padStart(7, '0')}`

export type AccountRole = 'company_admin' | 'clerk' | 'accountant' | 'govt_admin' | 'govt_agent'

export interface AccountOptions {
  // Join this company; without it a company member gets a new company (with one branch)
  companyId?: number
  companyName?: string
  address?: string | null
  tin?: string | null
  // A clerk's branch; the company's first one by default
  branchId?: number
  fullName?: string
  passwordHash?: string
  disabledAt?: Date
}

export interface Account {
  id: number
  companyId: number | null
  branchId: number | null
}

// An account with the given built-in role, written straight to the database
export async function createUser(
  username: string,
  role: AccountRole,
  options: AccountOptions = {}
): Promise<Account> {
  const db = getDb()
  const govt = role === 'govt_admin' || role === 'govt_agent'
  let companyId: number | null = null
  let branchId: number | null = null
  let roleId: number
  if (govt) {
    const [found] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(isNull(roles.companyId), eq(roles.key, role)))
    roleId = found.id
  } else {
    companyId = options.companyId ?? null
    if (companyId === null) {
      const { createCompany } = await import('../src/services/companies')
      const { company } = await createCompany(db, {
        name: options.companyName ?? `${username} Co.`,
        address: options.address === undefined ? 'Khartoum' : options.address,
        tin: options.tin === undefined ? '300123' : options.tin
      })
      companyId = company.id
      const [city] = await db.select({ id: cities.id }).from(cities).limit(1)
      await db.insert(branches).values({ companyId, name: 'Main office', cityId: city.id })
    }
    const [found] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.companyId, companyId), eq(roles.key, role)))
    roleId = found.id
    if (role === 'clerk') {
      const [first] = await db
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.companyId, companyId))
        .orderBy(branches.id)
        .limit(1)
      branchId = options.branchId ?? first.id
    }
  }
  const [user] = await db
    .insert(users)
    .values({
      username,
      kind: govt ? 'govt' : 'company',
      companyId,
      roleId,
      branchId,
      fullName: options.fullName ?? username,
      passwordHash: options.passwordHash ?? 'x',
      phone: nextPhone(),
      disabledAt: options.disabledAt ?? null
    })
    .returning({ id: users.id })
  return { id: user.id, companyId, branchId }
}

// Calls the API like one of the web apps: from an allowed origin, with the session cookie
export const ORIGIN = 'http://localhost:5175'

export interface Browser {
  cookie: string
  call: (
    method: string,
    path: string,
    body?: unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- responses are checked field by field
  ) => Promise<{ status: number; body: any; headers: Headers }>
}

export function browser(origin = ORIGIN): Browser {
  const self: Browser = {
    cookie: '',
    async call(method, path, body) {
      const { app } = await import('../src/app')
      const form = body instanceof FormData
      const response = await app.request(path, {
        method,
        headers: {
          Origin: origin,
          ...(self.cookie ? { Cookie: self.cookie } : {}),
          ...(body === undefined || form ? {} : { 'Content-Type': 'application/json' })
        },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body)
      })
      const setCookie = response.headers.get('set-cookie')
      if (setCookie) {
        const [pair] = setCookie.split(';')
        self.cookie = pair.endsWith('=') ? '' : pair
      }
      const json = response.headers.get('content-type')?.includes('application/json')
      return {
        status: response.status,
        body: json ? await response.json() : await response.arrayBuffer(),
        headers: response.headers
      }
    }
  }
  return self
}

export const PASSWORD = 'correct-horse'

// An account with PASSWORD, signed in from a fresh browser
export async function signedIn(
  username: string,
  role: AccountRole,
  options: AccountOptions = {}
): Promise<{ b: Browser } & Account> {
  const { hashPassword } = await import('../src/services/auth')
  const account = await createUser(username, role, {
    passwordHash: await hashPassword(PASSWORD),
    ...options
  })
  const govt = role === 'govt_admin' || role === 'govt_agent'
  const b = browser(govt ? 'http://localhost:5174' : 'http://localhost:5173')
  await b.call('POST', '/auth/login', { username, password: PASSWORD })
  return { b, ...account }
}
