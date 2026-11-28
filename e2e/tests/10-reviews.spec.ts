import { expect, test, type Page } from '@playwright/test'
import postgres from 'postgres'
import { E2E } from '../env'
import {
  ACCOUNTS,
  URLS,
  apiAs,
  authorizedTrip,
  cargoTrip,
  english,
  logIn,
  openSection
} from './support'

// Opens a trip from the government search by its number
async function openGovtTrip(page: Page, id: number): Promise<void> {
  await page.getByRole('searchbox').first().fill(`#${id}`)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.locator('main table tbody tr').first().click()
  await expect(page.getByText('Transport company').first()).toBeVisible()
}

// Opens a trip on the company portal from the trips list's search
async function openCompanyTrip(page: Page, id: number): Promise<void> {
  await page.getByRole('searchbox').first().fill(`#${id}`)
  await expect(page.getByText(/^Showing 1 of /)).toBeVisible()
  await page.locator('main table tbody tr').first().click()
}

test.describe('Review: reports, revocation and cancellation', () => {
  const db = postgres(E2E.migrationDatabaseUrl, { max: 1, onnotice: () => {} })
  test.afterAll(async () => db.end())
  const tokenOf = async (id: number): Promise<string> => {
    const [{ token }] =
      await db`select qr_token as token from certificates where manifest_id = ${id}`
    return token
  }

  test('REV-01 an agent reports a clearance from the trip view', async ({ page }) => {
    const id = await authorizedTrip(await apiAs(ACCOUNTS.owner))
    await logIn(page, ACCOUNTS.agent, URLS.govt)
    // Agents have no Reports section
    await expect(
      page.locator('nav').getByRole('button', { name: 'Reports', exact: true })
    ).toHaveCount(0)
    await openGovtTrip(page, id)
    await page.getByRole('button', { name: 'Report', exact: true }).click()
    await page.locator('dialog select').selectOption('forged_document')
    await page.locator('dialog textarea').fill('The invoice stamp looks altered')
    await page.getByRole('button', { name: 'Send report' }).click()
    await expect(page.getByText('Reported — under review').first()).toBeVisible()
    // One open report per trip: the button is gone, and the API refuses a second one
    await expect(page.getByRole('button', { name: 'Report', exact: true })).toHaveCount(0)
    const agent = await apiAs(ACCOUNTS.agent, URLS.govt)
    const again = await agent.post('/govt/reports', {
      data: { manifestId: id, reason: 'other', note: 'Again' }
    })
    expect(again.status()).toBe(409)
  })

  test('REV-02 the verify page warns while a report is open, and stays valid', async ({ page }) => {
    const id = await authorizedTrip(await apiAs(ACCOUNTS.owner))
    const agent = await apiAs(ACCOUNTS.agent, URLS.govt)
    await agent.post('/govt/reports', { data: { manifestId: id, reason: 'other', note: 'Check' } })
    await english(page)
    await page.goto(`${URLS.site}/verify/${await tokenOf(id)}`)
    await expect(page.getByRole('heading', { name: 'Valid manifest' })).toBeVisible()
    await expect(page.getByText('Reported — under review')).toBeVisible()
    await expect(page.getByText('Check', { exact: true })).toHaveCount(0)
  })

  test('REV-03 a supervisor dismisses a report from the Reports section', async ({ page }) => {
    const id = await authorizedTrip(await apiAs(ACCOUNTS.owner))
    const agent = await apiAs(ACCOUNTS.agent, URLS.govt)
    await agent.post('/govt/reports', {
      data: { manifestId: id, reason: 'cargo_mismatch', note: 'E2E dismiss me' }
    })
    await logIn(page, ACCOUNTS.supervisor, URLS.govt)
    await openSection(page, 'Reports')
    await page.locator('main table tbody tr', { hasText: 'E2E dismiss me' }).first().click()
    await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
    await page.locator('dialog textarea').fill('Checked with the customs office')
    await page.getByRole('button', { name: 'Dismiss report' }).click()
    await expect(page.getByText('Reported — under review')).toHaveCount(0)
    await expect(page.getByText('Dismissed').first()).toBeVisible()
    await expect(page.getByText('Authorized', { exact: true }).first()).toBeVisible()
  })

  test('REV-04 a supervisor revokes a clearance; the verify page says revoked', async ({
    page
  }) => {
    const id = await authorizedTrip(await apiAs(ACCOUNTS.owner))
    const agent = await apiAs(ACCOUNTS.agent, URLS.govt)
    await agent.post('/govt/reports', {
      data: { manifestId: id, reason: 'forged_document', note: 'E2E revoke me' }
    })
    await logIn(page, ACCOUNTS.supervisor, URLS.govt)
    await openSection(page, 'Reports')
    await page.locator('main table tbody tr', { hasText: 'E2E revoke me' }).first().click()
    await page.getByRole('button', { name: 'Revoke clearance' }).first().click()
    await page.locator('dialog textarea').fill('The commercial invoice was forged')
    await page.locator('dialog').getByRole('button', { name: 'Revoke clearance' }).click()
    await expect(page.getByText('Clearance revoked').first()).toBeVisible()

    await page.goto(`${URLS.site}/verify/${await tokenOf(id)}`)
    await expect(page.getByRole('heading', { name: 'Revoked manifest' })).toBeVisible()
    await expect(page.getByText(/not cleared to travel/)).toBeVisible()
  })

  test('REV-05 the company sees the revocation and the reason, not the report', async ({
    page
  }) => {
    const owner = await apiAs(ACCOUNTS.owner)
    const id = await authorizedTrip(owner)
    const agent = await apiAs(ACCOUNTS.agent, URLS.govt)
    const reported = await (
      await agent.post('/govt/reports', {
        data: { manifestId: id, reason: 'wrong_vehicle', note: 'E2E agent note' }
      })
    ).json()
    const supervisor = await apiAs(ACCOUNTS.supervisor, URLS.govt)
    await supervisor.post(`/govt/reports/${reported.data.reports[0].id}/revoke`, {
      data: { note: 'E2E supervisor reason' }
    })
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await openCompanyTrip(page, id)
    await expect(page.getByText('Clearance revoked').first()).toBeVisible()
    await expect(page.getByText('E2E supervisor reason')).toBeVisible()
    await expect(page.getByText('E2E agent note')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Show / download receipt and manifest' })
    ).toHaveCount(0)
  })

  test('REV-06 a supervisor cancels a trip whose bill is unpaid', async ({ page }) => {
    const owner = await apiAs(ACCOUNTS.owner)
    const created = await (await owner.post('/trips', { data: await cargoTrip(owner) })).json()
    const id = created.data.id as number
    expect((await owner.post(`/trips/${id}/bill`)).ok()).toBeTruthy()
    await logIn(page, ACCOUNTS.supervisor, URLS.govt)
    await openGovtTrip(page, id)
    await page.getByRole('button', { name: 'Cancel trip' }).first().click()
    await page.locator('dialog select').selectOption('wrong_vehicle')
    await page.locator('dialog textarea').fill('Booked on a vehicle that is off the road')
    await page.locator('dialog').getByRole('button', { name: 'Cancel trip' }).click()
    await expect(page.getByText('Trip cancelled').first()).toBeVisible()
    await expect(page.getByText('Bill cancelled')).toBeVisible()
    // Paying it afterwards changes nothing
    await owner.post(`/trips/${id}/simulate-payment`)
    expect((await owner.post(`/trips/${id}/refresh`)).status()).toBe(409)
  })
})
