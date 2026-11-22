/// <reference types="vite/client" />

// Each web app's .env (see its .env.example); the defaults suit local development
interface ImportMetaEnv {
  // https://api.masarat.com
  readonly VITE_API_URL?: string
  // https://masarat.com, where users log in
  readonly VITE_SITE_URL?: string
  // https://owner.masarat.com and https://govt.masarat.com
  readonly VITE_OWNER_URL?: string
  readonly VITE_GOVT_URL?: string
}
