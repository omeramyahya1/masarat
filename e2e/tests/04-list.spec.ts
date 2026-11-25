import { expect, test } from '@playwright/test'
import { ACCOUNTS, URLS, apiAs, cargoTrip, logIn } from './support'

const monthName = (offset: number): string => {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() + offset)
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
const day = (offset: number): string => {
  const d = new Date(Date.now() + offset * 86_400_000)
  return d.toISOString().slice(0, 10)
}

test.describe('The trips list', () => {
  test('LST-01 one month at a time', async ({ page }) => {
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await expect(page.getByText(monthName(0), { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(page.getByText(monthName(-1), { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(page.getByText(monthName(0), { exact: true })).toBeVisible()
  })

  test('LST-02 a custom period of up to 92 days', async ({ page }) => {
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await page.getByRole('button', { name: 'Custom period' }).click()
    const dates = page.locator('form input[type=date]')
    await dates.nth(0).fill(day(-200))
    await dates.nth(1).fill(day(0))
    await page.getByRole('button', { name: 'Show', exact: true }).click()
    await expect(
      page.getByText('Choose a period of at most 92 days that ends after it starts.')
    ).toBeVisible()
    // The form stays open to correct it
    await dates.nth(0).fill(day(-60))
    await dates.nth(1).fill(day(0))
    await page.getByRole('button', { name: 'Show', exact: true }).click()
    await expect(page.getByText(/ – /).first()).toBeVisible()
  })

  test('LST-03 the search matches whole names only', async ({ page }) => {
    const api = await apiAs(ACCOUNTS.owner)
    await api.post('/trips', {
      data: await cargoTrip(api, {
        shipper: { name: 'Whole Name Shipper Qx', address: 'Khartoum', phone: '0911111111' }
      })
    })
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    const search = page.getByRole('searchbox').first()
    await search.fill('Whole Name Shipper Qx')
    await expect(page.getByText(/^Showing 1 of /)).toBeVisible()
    await search.fill('Whole Name')
    await expect(page.getByText(/^Showing 0 of /)).toBeVisible()
  })

  test('LST-04 group by status across pages', async ({ page }) => {
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await page.getByLabel('Group by').selectOption({ label: 'Status' })
    await page.waitForLoadState('networkidle')
    // Each group's header carries its count and total due
    await expect(page.locator('main table tbody tr th').first()).toContainText('trips')
  })

  test("LST-05 a branch clerk sees their branch's trips only", async ({ page }) => {
    await logIn(page, ACCOUNTS.clerk, URLS.owner)
    await expect(page.getByLabel('Status')).toBeVisible()
    await expect(page.getByLabel('Branch', { exact: true })).toHaveCount(0)
  })
})
