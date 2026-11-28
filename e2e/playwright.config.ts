// End-to-end tests (docs/testing/e2e-scenarios.md): `bun run e2e` from the repo root. Needs the
// local services (`bun run db:up`: Postgres, Redis, MinIO). Starts its own stack on separate
// ports: a fresh masarat_e2e database (reset each run), the API in demo mode, and the three web
// apps, then runs the scenarios in Chromium.
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test'
import { E2E, URLS } from './env'

const root = new URL('..', import.meta.url).pathname
type WebServer = Extract<NonNullable<PlaywrightTestConfig['webServer']>, readonly unknown[]>[number]
const web = (app: string, url: string): WebServer => ({
  command: `bunx vite --port ${new URL(url).port} --strictPort`,
  cwd: `${root}apps/${app}`,
  url,
  env: E2E.webEnv,
  reuseExistingServer: false,
  timeout: 60_000
})

export default defineConfig({
  testDir: './tests',
  // The scenarios share one database: one worker, in file order
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  outputDir: 'results',
  use: {
    ...devices['Desktop Chrome'],
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-US',
    timezoneId: 'Africa/Khartoum'
  },
  webServer: [
    {
      // Reset the database, then the export worker and the API (which seeds the demo data on
      // startup). Playwright stops the whole process group, the worker with it.
      command:
        'bun scripts/reset-db.ts && cd ../apps/api && (bun src/exportWorker.ts & bun src/index.ts)',
      cwd: new URL('.', import.meta.url).pathname,
      url: `${URLS.api}/health/ready`,
      env: E2E.apiEnv,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'pipe'
    },
    web('site', URLS.site),
    web('owner-portal', URLS.owner),
    web('govt-portal', URLS.govt)
  ]
})
