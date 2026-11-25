import { expect, test, type APIRequestContext } from '@playwright/test'
import { ACCOUNTS, URLS, apiAs, cargoTrip, logIn } from './support'

// A bus trip's input: the company's first bus, the passengers given
async function busTrip(
  api: APIRequestContext,
  passengers: Record<string, unknown>[]
): Promise<Record<string, unknown>> {
  const vehicles = (await (await api.get('/vehicles')).json()).data as {
    id: number
    vehicleType: string
  }[]
  return cargoTrip(api, {
    vehicleId: vehicles.find((v) => v.vehicleType === 'bus')!.id,
    items: [],
    passengers,
    shipper: { name: '', address: '', phone: '' },
    receiver: { name: '', address: '', phone: '' }
  })
}

const passenger = (
  seatNo: number,
  idNumber: string | null,
  extra = {}
): Record<string, unknown> => ({
  fullName: `Passenger ${seatNo}`,
  idType: idNumber ? 'national_id' : null,
  idNumber,
  seatNo,
  isInfant: false,
  notes: null,
  ...extra
})

test.describe('Clerk: passenger trips', () => {
  test('PSG-01 a bus trip is priced by its seats', async ({ page }) => {
    const api = await apiAs(ACCOUNTS.owner)
    const created = await api.post('/trips', {
      data: await busTrip(api, [passenger(1, '11122233301'), passenger(2, '11122233302')])
    })
    expect(created.ok()).toBeTruthy()
    const trip = (await created.json()).data
    expect(trip.cargoQuantity).toBe(2)
    expect(trip.tripCost).toBe(trip.ticketPrice * 2)
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await page.getByRole('searchbox').first().fill(`#${trip.id}`)
    await expect(page.getByText(/^Showing 1 of /)).toBeVisible()
    await page.locator('main table tbody tr').first().click()
    await expect(page.getByText('Passenger 1').first()).toBeVisible()
    await expect(page.getByText('11122233301').first()).toBeVisible()
  })

  test('PSG-02 one passenger per seat', async () => {
    const api = await apiAs(ACCOUNTS.owner)
    const refused = await api.post('/trips', {
      data: await busTrip(api, [passenger(3, '11122233303'), passenger(3, '11122233304')])
    })
    expect((await refused.json()).error).toBe('seat_taken')
  })

  test('PSG-03 an infant shares a seat, without an ID or a ticket', async () => {
    const api = await apiAs(ACCOUNTS.owner)
    const created = await api.post('/trips', {
      data: await busTrip(api, [
        passenger(4, '11122233305'),
        passenger(4, null, { fullName: 'Baby', isInfant: true, notes: 'رضيع' })
      ])
    })
    expect(created.ok()).toBeTruthy()
    expect((await created.json()).data.cargoQuantity).toBe(1)
  })

  test('PSG-04 a template fills the form', async ({ page }) => {
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    await page.getByRole('button', { name: 'From a template' }).click()
    await page.getByRole('menuitem').first().click()
    await expect(page.getByLabel('Origin')).not.toHaveValue('')
    await expect(page.getByLabel('Destination')).not.toHaveValue('')
    await expect(page.getByLabel('Vehicle')).toContainText('Bus')
  })
})
