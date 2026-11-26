import { expect, test } from '@playwright/test'
import { ACCOUNTS, URLS, logIn, openSection } from './support'

test.describe('Caching', () => {
  test('CCH-01 sections already opened show without asking the API again', async ({ page }) => {
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await openSection(page, 'Vehicles')
    await openSection(page, 'Drivers')
    const calls: string[] = []
    page.on('request', (r) => {
      if (r.url().startsWith(URLS.api) && r.method() !== 'OPTIONS') calls.push(r.url())
    })
    await openSection(page, 'Trips')
    await openSection(page, 'Vehicles')
    await openSection(page, 'Drivers')
    expect(calls).toEqual([])
  })

  test('CCH-02 a new driver shows at once in Drivers and in the trip form', async ({ page }) => {
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await openSection(page, 'Drivers')
    await page.getByRole('button', { name: 'Add driver' }).first().click()
    await page.locator('dialog input').nth(0).fill('Cache Driver E2E')
    await page.locator('dialog input').nth(1).fill('0918880099')
    await page.locator('dialog button[type=submit]').click()
    await expect(page.getByRole('cell', { name: 'Cache Driver E2E' }).first()).toBeVisible()
    await openSection(page, 'Trips')
    await page.getByRole('button', { name: 'New trip' }).first().click()
    await expect(page.getByLabel('Driver')).toContainText('Cache Driver E2E')
  })

  test('CCH-03 a month already seen shows without asking again', async ({ page }) => {
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await page.getByRole('button', { name: 'Previous month' }).click()
    await page.waitForLoadState('networkidle')
    const calls: string[] = []
    page.on('request', (r) => {
      if (r.url().startsWith(`${URLS.api}/trips`)) calls.push(r.url())
    })
    await page.getByRole('button', { name: 'Next month' }).click()
    await page.waitForLoadState('networkidle')
    expect(calls).toEqual([])
  })
})

test.describe('Caching: the government dashboard', () => {
  test('CCH-04 Refresh asks for today only; the history is kept until the night', async ({
    page
  }) => {
    await logIn(page, ACCOUNTS.agent, URLS.govt)
    await expect(page.getByText('Revenue collected').first()).toBeVisible()
    const calls: string[] = []
    page.on('request', (r) => {
      if (r.url().startsWith(`${URLS.api}/govt/dashboard`)) calls.push(new URL(r.url()).pathname)
    })
    await page.getByRole('button', { name: 'Refresh' }).click()
    await page.waitForLoadState('networkidle')
    expect(calls).toEqual(['/govt/dashboard/today'])
  })
})
