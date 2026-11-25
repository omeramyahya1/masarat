// Last: it moves every finished trip older than a month to the archive
import { spawnSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import postgres from 'postgres'
import { E2E } from '../env'
import { ACCOUNTS, URLS, logIn } from './support'

test.describe('The archive', () => {
  // The specs run under Node: the API's script runs in Bun, as an operator would run it
  test.beforeAll(() => {
    const run = spawnSync('bun', ['run', 'trips:archive'], {
      cwd: new URL('../../apps/api/', import.meta.url).pathname,
      env: { ...process.env, ...E2E.apiEnv },
      encoding: 'utf8'
    })
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toMatch(/Moved [1-9]\d* trip/)
  })

  test('ARC-01 an archived trip is listed and opens read-only', async ({ page }) => {
    await logIn(page, ACCOUNTS.owner, URLS.owner)
    // Two months back: every finished trip of that month is in the archive now
    await page.getByRole('button', { name: 'Previous month' }).click()
    await page.getByRole('button', { name: 'Previous month' }).click()
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Status').selectOption({ label: 'Authorized' })
    await page.waitForLoadState('networkidle')
    await page.locator('main table tbody tr td').first().click()
    await expect(page.getByText(/This trip is in the archive/)).toBeVisible()
  })

  test('ARC-02 the government finds an archived trip', async ({ page }) => {
    const db = postgres(E2E.migrationDatabaseUrl, { max: 1, onnotice: () => {} })
    const [{ id }] = await db`select id from archive.manifests order by departure_at desc limit 1`
    await db.end()
    await logIn(page, ACCOUNTS.agent, URLS.govt)
    await page.getByRole('searchbox').first().fill(`#${id}`)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByText(/^1 trips? found$/)).toBeVisible()
    await page
      .getByRole('button', { name: `Open trip #${Number(id).toLocaleString('en-US')}` })
      .click()
    await expect(page.getByText(/This trip is in the archive/)).toBeVisible()
  })
})
