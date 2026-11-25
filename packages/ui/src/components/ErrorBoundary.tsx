import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'

// What a section shows when it failed to draw: a message and a way back, instead of a blank page.
// The rest of the portal (the header, the other sections) keeps working.
function ErrorFallback({ onRetry }: { onRetry: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div role="alert" className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-red-50 text-red-700">
        <TriangleAlert size={24} />
      </div>
      <h3 className="font-semibold text-stone-900">{t('shell.crash.title')}</h3>
      <p className="max-w-sm text-sm text-stone-500">{t('shell.crash.body')}</p>
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          {t('shell.crash.retry')}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          {t('shell.crash.reload')}
        </button>
      </div>
    </div>
  )
}

interface Props {
  children: ReactNode
}

// Catches an error while drawing its children. Wrap each section with a key per section, so
// moving to another section starts it afresh.
class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The browser console is where a support person looks; the API never saw this error
    console.error('A section failed to draw', error, info.componentStack)
  }

  render(): ReactNode {
    return this.state.failed ? (
      <ErrorFallback onRetry={() => this.setState({ failed: false })} />
    ) : (
      this.props.children
    )
  }
}

export default ErrorBoundary
