import type { ReactNode } from 'react'

// The centred card the login, sign-up and change-password pages are drawn in
function AuthCard({
  title,
  subtitle,
  wide = false,
  children
}: {
  title: string
  subtitle?: string
  wide?: boolean
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-1 items-start justify-center px-4 py-10 sm:px-6">
      <div className={`card w-full p-6 sm:p-8 ${wide ? 'max-w-xl' : 'max-w-md'}`}>
        <h1 className="text-lg font-semibold text-stone-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-500">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  )
}

export default AuthCard
