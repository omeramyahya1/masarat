import { readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8'))

export default defineConfig({
  resolve: {
    alias: {
      '@masarat/ui': resolve(import.meta.dirname, '../../packages/ui/src')
    }
  },
  // The favicons are shared by the three web apps
  publicDir: resolve(import.meta.dirname, '../../packages/ui/public'),
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  server: { port: 5173, strictPort: true },
  plugins: [react(), tailwindcss()]
})
