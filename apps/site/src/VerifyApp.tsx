import { hrefOf, type Page } from './router'
import SiteHeader from './components/SiteHeader'
import SiteFooter from './components/SiteFooter'
import VerifyPage from './pages/VerifyPage'

// masarat.com/verify/<token>, opened from a manifest's QR code. Unlike the other pages it doesn't
// look at the session or redirect anyone: an officer may be signed in, or not.
function VerifyApp({ token }: { token: string }): React.JSX.Element {
  const navigate = (page: Page): void => window.location.assign(hrefOf(page).split('?')[0])
  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <SiteHeader page="landing" navigate={navigate} />
      <main className="flex flex-1 flex-col">
        <VerifyPage token={token} />
      </main>
      <SiteFooter />
    </div>
  )
}

export default VerifyApp
