import type { ReactNode } from 'react'
import { hrefOf, type Page } from '../router'

// A real link (so it can be opened in a new tab) that changes page without reloading
function Link({
  to,
  navigate,
  className,
  children
}: {
  to: Page
  navigate: (page: Page) => void
  className?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <a
      href={hrefOf(to)}
      // The shared styles don't reset links (the portals have none): no underline unless .link
      className={`no-underline ${className ?? ''}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}

export default Link
