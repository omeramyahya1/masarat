// Where the end-to-end stack runs: its own ports and database, next to (not instead of) the
// development one, so a run never touches development data
const API_PORT = 3200
export const URLS = {
  api: `http://localhost:${API_PORT}`,
  site: 'http://localhost:5275',
  owner: 'http://localhost:5273',
  govt: 'http://localhost:5274'
}

const databaseUrl = 'postgres://masarat_app:masarat_app@localhost:5433/masarat_e2e'
const migrationDatabaseUrl = 'postgres://masarat:masarat@localhost:5433/masarat_e2e'

export const E2E = {
  databaseUrl,
  migrationDatabaseUrl,
  // The API's environment (apps/api/.env doesn't apply: these come first)
  apiEnv: {
    APP_ENV: 'development',
    PORT: String(API_PORT),
    DATABASE_URL: databaseUrl,
    MIGRATION_DATABASE_URL: migrationDatabaseUrl,
    DEMO_MODE: 'true',
    SITE_URL: URLS.site,
    OWNER_URL: URLS.owner,
    GOVT_URL: URLS.govt,
    COOKIE_DOMAIN: '',
    S3_BUCKET: 'masarat-test',
    STORAGE_DIR: new URL('./.storage', import.meta.url).pathname,
    LOG_DIR: '',
    LOG_PRETTY: 'false',
    LOG_LEVEL: 'warn',
    TRUST_PROXY: 'false'
  },
  // Each web app's environment
  webEnv: {
    VITE_API_URL: URLS.api,
    VITE_SITE_URL: URLS.site,
    VITE_OWNER_URL: URLS.owner,
    VITE_GOVT_URL: URLS.govt,
    VITE_COOKIE_DOMAIN: ''
  }
}
