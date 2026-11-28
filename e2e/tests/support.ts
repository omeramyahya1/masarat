// What the scenarios share: signing in through masarat.com, the English interface, and an API
// session for setting up data the way a member's browser would
import { expect, request, type APIRequestContext, type Page } from '@playwright/test'
import { URLS } from '../env'

export { URLS }

export const ACCOUNTS = {
  owner: { username: 'nile.transport', password: 'nile2026' },
  clerk: { username: 'nile.clerk1', password: 'nile2026' },
  accountant: { username: 'nile.accountant', password: 'nile2026' },
  govtAdmin: { username: 'ministry.demo', password: 'govt2026' },
  supervisor: { username: 'ministry.supervisor', password: 'govt2026' },
  agent: { username: 'ministry.agent', password: 'govt2026' }
} as const
type Account = { username: string; password: string }

// The interface in English (the default is Arabic), for readable selectors
export async function english(page: Page): Promise<void> {
  await page
    .context()
    .addCookies([{ name: 'masarat_lang', value: 'en', domain: 'localhost', path: '/' }])
}

// Logs in on masarat.com and waits for the portal the account belongs to
export async function logIn(page: Page, account: Account, portal: string): Promise<void> {
  await english(page)
  await page.goto(`${URLS.site}/login`)
  await page.locator('input[autocomplete=username]').fill(account.username)
  await page.locator('input[autocomplete=current-password]').fill(account.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL(`${portal}/**`)
  await page.waitForLoadState('networkidle')
}

// A section of a portal, from the section bar
export async function openSection(page: Page, name: string): Promise<void> {
  await page.locator('nav').getByRole('button', { name, exact: true }).first().click()
  await page.waitForLoadState('networkidle')
}

// An API session as a member, for setting up data (the Origin is the portal's, as from a browser)
export async function apiAs(
  account: Account,
  portal: string = URLS.owner
): Promise<APIRequestContext> {
  const api = await request.newContext({ baseURL: URLS.api, extraHTTPHeaders: { Origin: portal } })
  const login = await api.post('/auth/login', { data: account })
  expect(login.ok(), `log in as ${account.username}`).toBeTruthy()
  return api
}

// "YYYY-MM-DDTHH:MM" local time, `days` from today
export function localTime(days: number, hour = 8): string {
  const d = new Date(Date.now() + days * 86_400_000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:00`
}

// A complete cargo trip for the API, on the company's first non-bus vehicle and first driver
export async function cargoTrip(
  api: APIRequestContext,
  overrides: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const reference = (await (await api.get('/trips/reference')).json()).data
  const city = (name: string): number =>
    reference.cities.find((c: { name: string }) => c.name === name).id
  const vehicles = (await (await api.get('/vehicles')).json()).data as {
    id: number
    vehicleType: string
  }[]
  const drivers = (await (await api.get('/drivers')).json()).data as { id: number }[]
  const branches = (await (await api.get('/branches')).json()).data as {
    id: number
    active: boolean
  }[]
  return {
    branchId: branches.find((b) => b.active)!.id,
    vehicleId: vehicles.find((v) => v.vehicleType !== 'bus' && v.vehicleType !== 'tanker')!.id,
    originCityId: city('Khartoum'),
    destinationCityId: city('Port Sudan'),
    items: [
      {
        name: 'E2E cement',
        quantity: 10,
        unit: 'ton',
        cargoType: 'general_cargo',
        packingType: 'Bags',
        packageCount: 200,
        notes: null
      }
    ],
    departureAt: localTime(1),
    arrivalAt: localTime(2),
    tripKind: 'domestic',
    trailers: [],
    driverId: drivers[0].id,
    shipper: { name: 'E2E Sender', address: 'Khartoum', phone: '0911111111' },
    receiver: { name: 'E2E Receiver', address: 'Port Sudan', phone: '0922222222' },
    ...overrides
  }
}

// A trip through its bill and payment to its authorized documents; returns its id
export async function authorizedTrip(api: APIRequestContext): Promise<number> {
  const created = await api.post('/trips', { data: await cargoTrip(api) })
  expect(created.ok()).toBeTruthy()
  const id = (await created.json()).data.id as number
  expect((await api.post(`/trips/${id}/bill`)).ok()).toBeTruthy()
  expect((await api.post(`/trips/${id}/simulate-payment`)).ok()).toBeTruthy()
  const refreshed = await (await api.post(`/trips/${id}/refresh`)).json()
  expect(refreshed.data.trip.status).toBe('certified')
  return id
}

// A data export through the API: queued, prepared by the export worker, then its file (the text)
export async function exportText(api: APIRequestContext, input: unknown): Promise<string> {
  const queued = await api.post('/govt/exports', { data: input })
  expect(queued.status(), 'export queued').toBe(202)
  const id = (await queued.json()).data.id
  await expect
    .poll(async () => (await (await api.get(`/govt/exports/${id}`)).json()).data.status, {
      timeout: 60_000
    })
    .toBe('done')
  const file = await api.get(`/govt/exports/${id}/file`)
  expect(file.ok()).toBeTruthy()
  return file.text()
}
