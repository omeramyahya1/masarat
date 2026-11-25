import { expect, test } from '@playwright/test'
import { ACCOUNTS, URLS, apiAs, english, logIn } from './support'

test.describe('Sessions and access', () => {
  test('AUTH-01 a company admin logs in to the company portal', async ({ page }) => {
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await expect(page.getByRole('heading', { name: 'Trips' }).first()).toBeVisible()
    await expect(page.getByText('nile.transport')).toBeVisible()
  })

  test('AUTH-02 a government user logs in to the government portal', async ({ page }) => {
    await logIn(page, ACCOUNTS.agent, URLS.govt)
    await expect(page.locator('nav').getByRole('button', { name: 'Overview' })).toBeVisible()
  })

  test('AUTH-03 a wrong password is refused like an unknown username', async ({ page }) => {
    await english(page)
    await page.goto(`${URLS.site}/login`)
    for (const username of ['nile.transport', 'nobody.here']) {
      await page.locator('input[autocomplete=username]').fill(username)
      await page.locator('input[autocomplete=current-password]').fill('wrong-password')
      await page.getByRole('button', { name: 'Log in' }).click()
      await expect(page.getByText('Incorrect username or password.')).toBeVisible()
    }
    await expect(page).toHaveURL(`${URLS.site}/login`)
  })

  test('AUTH-04 a portal without a session sends to login and back', async ({ page }) => {
    await english(page)
    await page.goto(`${URLS.owner}/`)
    await page.waitForURL(`${URLS.site}/login**`)
    expect(new URL(page.url()).searchParams.get('next')).toContain(URLS.owner)
    await page.locator('input[autocomplete=username]').fill(ACCOUNTS.owner.username)
    await page.locator('input[autocomplete=current-password]').fill(ACCOUNTS.owner.password)
    await page.getByRole('button', { name: 'Log in' }).click()
    await page.waitForURL(`${URLS.owner}/**`)
  })

  test('AUTH-05 the other portal sends a company member back to theirs', async ({ page }) => {
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await page.goto(`${URLS.govt}/`)
    await page.waitForURL(`${URLS.owner}/**`)
  })

  test('AUTH-06 a temporary password must be changed first', async ({ page }) => {
    const admin = await apiAs(ACCOUNTS.owner)
    const branches = (await (await admin.get('/branches')).json()).data
    const roles = (await (await admin.get('/members/roles')).json()).data
    const clerkRole = roles.find((r: { key: string | null }) => r.key === 'clerk')
    const created = await admin.post('/members', {
      data: {
        username: 'e2e.newclerk',
        fullName: 'New Clerk',
        phone: '0917770001',
        roleId: clerkRole.id,
        branchId: branches[0].id
      }
    })
    const { temporaryPassword } = (await created.json()).data
    await english(page)
    await page.goto(`${URLS.site}/login`)
    await page.locator('input[autocomplete=username]').fill('e2e.newclerk')
    await page.locator('input[autocomplete=current-password]').fill(temporaryPassword)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page.getByRole('heading', { name: 'Choose your own password' })).toBeVisible()
    const passwords = page.locator('input[type=password]')
    await passwords.nth(0).fill(temporaryPassword)
    await passwords.nth(1).fill('e2e-own-password')
    await passwords.nth(2).fill('e2e-own-password')
    await page.getByRole('button', { name: 'Save password' }).click()
    await page.waitForURL(`${URLS.owner}/**`)
  })

  test('AUTH-07 logging out returns to masarat.com and ends the session', async ({ page }) => {
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await page.getByRole('button', { name: 'Log out' }).click()
    await page.waitForURL(`${URLS.site}/**`)
    await page.goto(`${URLS.owner}/`)
    await page.waitForURL(`${URLS.site}/login**`)
  })

  test('AUTH-08 the site opens in Arabic, right to left', async ({ page }) => {
    await page.goto(`${URLS.site}/login`)
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('button', { name: 'تسجيل الدخول' })).toBeVisible()
  })
})
