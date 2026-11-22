import '@masarat/ui/assets/main.css'
import '@masarat/ui/i18n'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import VerifyApp from './VerifyApp'
import { verifyTokenOf } from './router'

const verifyToken = verifyTokenOf(window.location.pathname)

createRoot(document.getElementById('root')!).render(
  <StrictMode>{verifyToken ? <VerifyApp token={verifyToken} /> : <App />}</StrictMode>
)
