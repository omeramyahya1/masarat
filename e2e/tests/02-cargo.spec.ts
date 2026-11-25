import { expect, test, type Page } from '@playwright/test'
import { ACCOUNTS, URLS, apiAs, authorizedTrip, cargoTrip, localTime, logIn } from './support'

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')

// The first heavy-duty or other truck (not a tanker or bus) in the vehicle list
async function pickTruck(page: Page): Promise<void> {
  const options = await page.getByLabel('Vehicle').locator('option').allTextContents()
  const truck = options.find((o) => /truck|Lorry/i.test(o) && !/Tanker|Bus/i.test(o))!
  await page.getByLabel('Vehicle').selectOption({ label: truck })
}

// A trip page's title (its number with thousands separators)
const tripTitle = (id: number): string => `Trip #${id.toLocaleString('en-US')}`

async function openTrip(page: Page, id: number): Promise<void> {
  await page.goto(`${URLS.owner}/`)
  await page.waitForLoadState('networkidle')
  // The list shows the current month; the trip page is reached from its row, or straight from
  // the API's id through the search
  await page.getByRole('searchbox').first().fill(`#${id}`)
  await expect(page.getByText(/^Showing 1 of /)).toBeVisible()
  await page.locator('main table tbody tr').first().click()
  await expect(page.getByRole('heading', { name: tripTitle(id) })).toBeVisible()
}

test.describe('Clerk: cargo trips', () => {
  test('CRG-01 book a cargo trip through the form', async ({ page }) => {
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await page.getByRole('button', { name: 'New trip' }).first().click()
    // A company admin books for any branch: they pick it
    await page.getByLabel('Branch').selectOption({ index: 1 })
    await pickTruck(page)
    await page.getByLabel('Driver').selectOption({ index: 1 })
    await page.getByLabel('Origin').selectOption({ label: 'Khartoum' })
    await page.getByLabel('Destination').selectOption({ label: 'Port Sudan' })
    await page.getByLabel('Departure').fill(localTime(1))
    await page.getByLabel('Estimated arrival').fill(localTime(2))
    const names = page.getByLabel('Name (person or company)')
    const addresses = page.getByLabel('Address')
    const phones = page.getByLabel('Phone number')
    await names.nth(0).fill('Form Sender Co')
    await addresses.nth(0).fill('Khartoum')
    await phones.nth(0).fill('0911000001')
    await names.nth(1).fill('Form Receiver Co')
    await addresses.nth(1).fill('Port Sudan')
    await phones.nth(1).fill('0911000002')
    await page.getByLabel('Item 1 cargo type').selectOption({ index: 1 })
    await page.getByLabel('Item 1 name').fill('Cement')
    await page.getByLabel('Item 1 weight').fill('12')
    await page.getByLabel('Item 1 packing type').fill('Sacks')
    await page.getByLabel('Item 1 number of packages').fill('240')
    await page.getByRole('button', { name: 'Save trip' }).click()
    // Saved as a draft, and on its page
    await expect(page.getByRole('heading', { name: /^Trip #[\d,]+$/ })).toBeVisible()
    await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Generate bill ID' })).toBeVisible()
  })

  test('CRG-02 missing details block the bill', async ({ page }) => {
    const api = await apiAs(ACCOUNTS.owner)
    const created = await api.post('/trips', { data: await cargoTrip(api, { driverId: null }) })
    const id = (await created.json()).data.id
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await openTrip(page, id)
    await expect(
      page.getByText('Complete the manifest before generating the bill ID:')
    ).toBeVisible()
    await expect(page.getByText('Choose the driver')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Generate bill ID' })).toBeDisabled()
  })

  test('CRG-03 bill, pay and authorize; the documents open', async ({ page }) => {
    const api = await apiAs(ACCOUNTS.owner)
    const id = (await (await api.post('/trips', { data: await cargoTrip(api) })).json()).data.id
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await openTrip(page, id)
    await page.getByRole('button', { name: 'Generate bill ID' }).click()
    await expect(page.getByText('Pending payment').first()).toBeVisible()
    await expect(page.getByText('E-Sali bill ID').first()).toBeVisible()
    // The demo's payment, then the status refresh
    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: /Pay \d{22}/ }).click()
    await page.getByRole('button', { name: 'Refresh status' }).click()
    await expect(page.getByText('Authorized').first()).toBeVisible()
    await expect(page.getByText(/MNF-\d{4}-\d{6}/).first()).toBeVisible()
    await page.getByRole('button', { name: 'Show / download receipt and manifest' }).click()
    await expect(page.getByText(/MSR-\d{4}-\d{6}/).first()).toBeVisible()
  })

  test('CRG-04 attach a document and preview it', async ({ page }) => {
    const api = await apiAs(ACCOUNTS.owner)
    const id = (await (await api.post('/trips', { data: await cargoTrip(api) })).json()).data.id
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await openTrip(page, id)
    await page.getByRole('button', { name: 'Edit trip' }).click()
    // Attach opens the browser's file picker for the commercial invoice's slot
    const chooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Attach' }).first().click()
    await (
      await chooser
    ).setFiles({ name: 'invoice.pdf', mimeType: 'application/pdf', buffer: PDF })
    await expect(page.getByText('invoice.pdf')).toBeVisible()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('heading', { name: tripTitle(id) })).toBeVisible()
    await page.getByRole('button', { name: 'View Commercial invoice' }).click()
    await expect(page.getByRole('link', { name: 'Download' })).toBeVisible()
    await expect(page.getByText('invoice.pdf').last()).toBeVisible()
  })

  test('CRG-05 edit and delete a draft', async ({ page }) => {
    const api = await apiAs(ACCOUNTS.owner)
    const id = (await (await api.post('/trips', { data: await cargoTrip(api) })).json()).data.id
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await openTrip(page, id)
    await page.getByRole('button', { name: 'Edit trip' }).click()
    await page.getByLabel('Item 1 name').fill('Edited cement')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Edited cement').first()).toBeVisible()
    await page.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('button', { name: 'Delete trip' }).click()
    await expect(page.getByText(`${tripTitle(id)} was deleted.`)).toBeVisible()
    expect((await api.get(`/trips/${id}`)).status()).toBe(404)
  })

  test('CRG-06 an authorized trip can no longer be changed', async ({ page }) => {
    const api = await apiAs(ACCOUNTS.owner)
    const id = await authorizedTrip(api)
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await openTrip(page, id)
    await expect(page.getByText('Authorized').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Edit trip' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0)
  })
})
