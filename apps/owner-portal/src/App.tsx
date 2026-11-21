import AppShell from '@masarat/ui/components/AppShell'
import OwnerWorkspace from './components/OwnerWorkspace'

function App(): React.JSX.Element {
  return (
    <AppShell role="owner" version={__APP_VERSION__}>
      {(user, onUserChange) => <OwnerWorkspace user={user} onUserChange={onUserChange} />}
    </AppShell>
  )
}

export default App
