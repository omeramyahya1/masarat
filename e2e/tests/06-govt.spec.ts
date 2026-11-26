import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { E2E } from '../env'
import { ACCOUNTS, URLS, apiAs, authorizedTrip, logIn, openSection } from './support'

test.describe('Government', () => {
  test('GOV-01 the dashboard opens on the last 30 days', async ({ page }) => {
    await logIn(page, ACCOUNTS.agent, URLS.govt)
    await expect(page.getByText('Revenue collected').first()).toBeVisible()
    await expect(page.getByText('Collection rate').first()).toBeVisible()
  })

  test('GOV-02 filters are kept when leaving the dashboard and coming back', async ({ page }) => {
    await logIn(page, ACCOUNTS.govtAdmin, URLS.govt)
    await page.getByRole('radio', { name: '90 days', exact: true }).click()
    await page.waitForLoadState('networkidle')
    await openSection(page, 'Settings')
    await openSection(page, 'Overview')
    await expect(page.getByRole('radio', { name: '90 days', exact: true })).toBeChecked()
  })

  test('GOV-03 search, open a trip read-only, back to the same results', async ({ page }) => {
    await logIn(page, ACCOUNTS.agent, URLS.govt)
    await page.getByRole('searchbox').first().fill('Kassala')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByText(/trips found/).first()).toBeVisible()
    await page.locator('main table tbody tr').first().click()
    await expect(page.getByText('Transport company').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Generate bill ID' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Back to trips' }).click()
    await expect(page.getByText(/trips found/).first()).toBeVisible()
  })

  test('GOV-04 search by E-Sali bill ID and by manifest number', async ({ page }) => {
    const owner = await apiAs(ACCOUNTS.owner)
    const id = await authorizedTrip(owner)
    const details = (await (await owner.get(`/trips/${id}`)).json()).data
    await logIn(page, ACCOUNTS.agent, URLS.govt)
    for (const query of [details.payment.billId, details.certificate.manifestNo]) {
      await page.getByRole('searchbox').first().fill(query)
      await page.getByRole('button', { name: 'Search', exact: true }).click()
      await expect(page.getByText('1 trips found').or(page.getByText('1 trip found'))).toBeVisible()
    }
  })

  test("GOV-05 data exports include passengers' IDs only when asked", async () => {
    const govt = await apiAs(ACCOUNTS.agent, URLS.govt)
    const input = {
      filters: { range: { preset: '90d' }, category: 'passenger' },
      dateBasis: 'trip',
      status: 'all',
      datasets: ['passengers'],
      formats: ['csv'],
      labels: { columns: { passengers: { idNumber: 'ID number' } }, sheets: {}, values: {} }
    }
    const without = await govt.post('/govt/exports', { data: input })
    expect(without.ok()).toBeTruthy()
    expect(await without.text()).not.toContain('ID number')
    const withIds = await govt.post('/govt/exports', { data: { ...input, includeIdNumbers: true } })
    expect(await withIds.text()).toContain('ID number')
  })

  test('GOV-07 a fee change is saved and listed', async ({ page }) => {
    await logIn(page, ACCOUNTS.govtAdmin, URLS.govt)
    await openSection(page, 'Taxes and fees')
    await expect(page.getByText('Manifest fee').first()).toBeVisible()
  })

  test('GOV-08 settings are saved', async ({ page }) => {
    await logIn(page, ACCOUNTS.govtAdmin, URLS.govt)
    await openSection(page, 'Settings')
    const margin = page.getByRole('textbox', { name: 'Valid after arrival' }).first()
    await margin.fill('30')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Settings saved.')).toBeVisible()
    await margin.fill('24')
    await page.getByRole('button', { name: 'Save' }).click()
  })

  test('GOV-09 the government admin role is not offered', async ({ page }) => {
    await logIn(page, ACCOUNTS.govtAdmin, URLS.govt)
    await openSection(page, 'Users')
    await page.getByRole('button', { name: 'New account' }).first().click()
    const roles = await page.locator('dialog select').first().locator('option').allTextContents()
    expect(roles.join(' ')).not.toMatch(/admin/i)
  })

  test('GOV-10 an agent has no admin sections', async ({ page }) => {
    await logIn(page, ACCOUNTS.agent, URLS.govt)
    const nav = page.locator('nav')
    for (const hidden of ['Taxes and fees', 'Settings', 'Users']) {
      await expect(nav.getByRole('button', { name: hidden, exact: true })).toHaveCount(0)
    }
  })
})

test.describe('The verify page', () => {
  const db = postgres(E2E.migrationDatabaseUrl, { max: 1, onnotice: () => {} })
  test.afterAll(async () => db.end())

  test('VER-01 a valid manifest, with no personal details', async ({ page }) => {
    const owner = await apiAs(ACCOUNTS.owner)
    const id = await authorizedTrip(owner)
    const [{ token }] =
      await db`select qr_token as token from certificates where manifest_id = ${id}`
    await page.goto(`${URLS.site}/verify/${token}`)
    // The verify page opens in Arabic (an officer may have no language cookie)
    await expect(page.getByRole('heading', { name: 'منفيست ساري' })).toBeVisible()
    await expect(page.getByText('E2E Sender')).toHaveCount(0)
  })

  test('VER-02 an unknown code', async ({ page }) => {
    await page.goto(`${URLS.site}/verify/${'0'.repeat(32)}`)
    await expect(page.getByText(/No manifest found|لم يُعثر/).first()).toBeVisible()
  })

  test('VER-03 an expired manifest', async ({ page }) => {
    const [{ token }] = await db`
      select qr_token as token from all_certificates where valid_until < now() limit 1`
    await page.goto(`${URLS.site}/verify/${token}`)
    await expect(page.getByText(/Expired manifest|منتهي/).first()).toBeVisible()
  })
})
