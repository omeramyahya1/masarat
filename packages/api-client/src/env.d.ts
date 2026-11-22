// Set by Vite in the web apps that bundle this client (their .env)
interface ImportMetaEnv {
  // The API's base URL, e.g. https://api.masarat.com
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
