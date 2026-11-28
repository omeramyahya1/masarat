import { and, eq, isNull, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { branches, cities, getDb, roles, users } from '../src/db'
import { config } from '../src/config'

// The owner's connection, for what the API's role may not do (TRUNCATE)
const owner = drizzle(
  postgres(config.migrationDatabaseUrl, { max: 1, idle_timeout: 1, onnotice: () => {} })
)

// Empties every table except the reference data the migrations seeded (the government's roles
// among it)
export async function resetData(): Promise<void> {
  await owner.execute(sql`
    truncate sessions, login_attempts, esali_sim_bills, certificates, payments, manifest_charges,
      trip_documents, manifest_trailers, manifest_cargo_items, manifests, vehicles, drivers,
      charge_changes, daily_revenue, people, trip_decisions, trip_reports, users,
      archive.certificates, archive.payments, archive.manifest_charges, archive.trip_documents,
      archive.trip_passengers, archive.manifest_trailers, archive.manifest_cargo_items,
      archive.manifests restart identity cascade
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

export type AccountRole =
  'company_admin' | 'clerk' | 'accountant' | 'govt_admin' | 'govt_supervisor' | 'govt_agent'

const isGovtRole = (role: AccountRole): boolean => role.startsWith('govt_')

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
  const govt = isGovtRole(role)
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
  const govt = isGovtRole(role)
  const b = browser(govt ? 'http://localhost:5174' : 'http://localhost:5173')
  await b.call('POST', '/auth/login', { username, password: PASSWORD })
  return { b, ...account }
}

// An export the way the portal runs one: queued through the API, prepared by the export worker
// (run here, in this process, until the queue is empty), then its file downloaded. Answers the
// file's response, or, when the export failed or was refused, its job (`status: 'failed'`) or the
// queue's refusal.
export async function exportThrough(
  b: Browser,
  input: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- checked field by field
): Promise<{ status: number | 'failed'; body: any; headers: Headers }> {
  const queued = await b.call('POST', '/govt/exports', input)
  if (queued.status !== 202) return queued
  const { drainExports } = await import('../src/services/exportWorker')
  await drainExports()
  const job = await b.call('GET', `/govt/exports/${queued.body.data.id}`)
  if (job.body.data.status !== 'done')
    return { status: 'failed', body: job.body.data, headers: job.headers }
  return b.call('GET', `/govt/exports/${queued.body.data.id}/file`)
}
