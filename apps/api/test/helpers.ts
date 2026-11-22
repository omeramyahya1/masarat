import { sql } from 'drizzle-orm'
import { getDb, users } from '../src/db'

// Empties every table except the reference data the migrations seeded
export async function resetData(): Promise<void> {
  await getDb().execute(sql`
    truncate sessions, login_attempts, esali_sim_bills, certificates, payments, manifest_taxes, trip_documents,
      manifest_trailers, manifest_cargo_items, manifests, vehicles, drivers, tax_setting_changes,
      users restart identity cascade
  `)
  await getDb().execute(sql`
    update tax_settings set rate_bps = case code
      when 'vat' then 1700 when 'business_profit' then 300 when 'locality' then 200 end
    where amount is null
  `)
  await getDb().execute(sql`update tax_settings set amount = 1500 where code = 'manifest_fee'`)
}

export async function createUser(
  values: Partial<typeof users.$inferInsert> & { username: string; role: 'owner' | 'govt' }
): Promise<number> {
  const [user] = await getDb()
    .insert(users)
    .values({ fullName: values.username, passwordHash: 'x', ...values })
    .returning({ id: users.id })
  return user.id
}

// Calls the API like one of the web apps: from an allowed origin, with the session cookie
export const ORIGIN = 'http://localhost:5175'

export interface Browser {
  cookie: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- responses are checked field by field
  call: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>
}

export function browser(origin = ORIGIN): Browser {
  const self: Browser = {
    cookie: '',
    async call(method, path, body) {
      const { app } = await import('../src/app')
      const response = await app.request(path, {
        method,
        headers: {
          Origin: origin,
          ...(self.cookie ? { Cookie: self.cookie } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
      const setCookie = response.headers.get('set-cookie')
      if (setCookie) {
        const [pair] = setCookie.split(';')
        self.cookie = pair.endsWith('=') ? '' : pair
      }
      return { status: response.status, body: await response.json() }
    }
  }
  return self
}
