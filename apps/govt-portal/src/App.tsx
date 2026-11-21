import AppShell from '@masarat/ui/components/AppShell'
import GovtWorkspace from './components/govt/GovtWorkspace'

function App(): React.JSX.Element {
  return (
    <AppShell role="govt" version={__APP_VERSION__}>
      {() => <GovtWorkspace />}
    </AppShell>
  )
}

export default App
