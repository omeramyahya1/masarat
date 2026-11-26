import { expect, test } from '@playwright/test'
import { ACCOUNTS, URLS, apiAs, english, logIn, openSection } from './support'

test.describe('Company admin', () => {
  test('ADM-01 sign up a company', async ({ page }) => {
    await english(page)
    await page.goto(`${URLS.site}/signup`)
    await page.getByLabel('Full name').fill('E2E Founder')
    await page.getByLabel('Username').fill('e2e.founder')
    await page.getByLabel('Phone number').fill('0918880001')
    await page.getByLabel('Company name').fill('E2E Haulage')
    await page.getByLabel('Password', { exact: true }).fill('e2e-founder-pass')
    await page.getByLabel('Confirm password').fill('e2e-founder-pass')
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL(`${URLS.owner}/**`)
    await expect(page.getByText('E2E Haulage')).toBeVisible()
  })

  test('ADM-02 company details are saved', async ({ page }) => {
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await openSection(page, 'Profile')
    await page.getByLabel('Address').last().fill('Bahri, Khartoum North')
    await page.getByRole('button', { name: 'Save company details' }).click()
    await expect(page.getByText(/saved/i).last()).toBeVisible()
  })

  test('ADM-03 add a branch', async ({ page }) => {
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await openSection(page, 'Branches')
    await page.getByRole('button', { name: 'New branch' }).first().click()
    await page.getByLabel('Branch name').fill('E2E Kassala booth')
    await page.getByLabel('City').selectOption({ label: 'Kassala' })
    await page.getByRole('button', { name: 'Save branch' }).click()
    await expect(page.getByRole('cell', { name: 'E2E Kassala booth' }).first()).toBeVisible()
  })

  test('ADM-04 a custom role can be given in Team', async ({ page }) => {
    const api = await apiAs(ACCOUNTS.owner)
    const created = await api.post('/roles', {
      data: { name: 'E2E Dispatcher', scope: 'company', permissions: ['trips.view'] }
    })
    expect(created.ok()).toBeTruthy()
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await openSection(page, 'Team')
    await page.getByRole('button', { name: 'New account' }).first().click()
    await expect(page.locator('dialog select').first()).toContainText('E2E Dispatcher')
  })

  test('ADM-05 add a member: the temporary password is shown once', async ({ page }) => {
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await openSection(page, 'Team')
    await page.getByRole('button', { name: 'New account' }).first().click()
    const dialog = page.locator('dialog')
    await dialog.getByLabel('Full name').fill('E2E Member')
    await dialog.getByLabel('Username').fill('e2e.member')
    await dialog.getByLabel('Phone number').fill('0918880002')
    await dialog.locator('select').first().selectOption({ label: 'Accountant' })
    await dialog.getByRole('button', { name: 'Create account' }).click()
    await expect(page.getByText(/temporary password/i).first()).toBeVisible()
  })

  test('ADM-06 a disabled member cannot log in', async ({ page }) => {
    const api = await apiAs(ACCOUNTS.owner)
    const members = (await (await api.get('/members')).json()).data as {
      id: number
      username: string
    }[]
    const accountant = members.find((m) => m.username === 'nile.accountant')!
    // Done last in the file: other scenarios log in as the accountant before
    expect((await api.post(`/members/${accountant.id}/disable`)).ok()).toBeTruthy()
    await english(page)
    await page.goto(`${URLS.site}/login`)
    await page.locator('input[autocomplete=username]').fill(ACCOUNTS.accountant.username)
    await page.locator('input[autocomplete=current-password]').fill(ACCOUNTS.accountant.password)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(
      page.getByText('This account has been disabled. Contact your administrator.')
    ).toBeVisible()
    await api.post(`/members/${accountant.id}/enable`)
  })
})

test.describe('Accountant', () => {
  test('ACC-01 sees and bills trips, manages nothing', async ({ page }) => {
    await logIn(page, ACCOUNTS.accountant, URLS.owner)
    const nav = page.locator('nav')
    for (const visible of ['Trips', 'Vehicles', 'Drivers']) {
      await expect(nav.getByRole('button', { name: visible, exact: true })).toBeVisible()
    }
    for (const hidden of ['Team', 'Branches', 'Roles']) {
      await expect(nav.getByRole('button', { name: hidden, exact: true })).toHaveCount(0)
    }
    await openSection(page, 'Vehicles')
    await expect(page.getByRole('button', { name: 'Add vehicle' })).toHaveCount(0)
  })
})
