import AppShell from '@masarat/ui/components/AppShell'
import GovtWorkspace from './components/govt/GovtWorkspace'

function App(): React.JSX.Element {
  return (
    <AppShell role="govt" version={__APP_VERSION__}>
      {(user) => <GovtWorkspace user={user} />}
    </AppShell>
  )
}

export default App
