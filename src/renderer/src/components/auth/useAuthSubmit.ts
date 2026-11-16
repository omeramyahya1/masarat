import { useState } from 'react'
import type { AuthResult, AuthUser } from '../../../../shared/auth'
import type { AuthFormError } from './fields'

interface AuthSubmit {
  error: AuthFormError | null
  pending: boolean
  setError: (error: AuthFormError | null) => void
  submit: (request: () => Promise<AuthResult>) => Promise<void>
}

// Shared pending/error handling for the login and sign-up forms
export function useAuthSubmit(onAuthenticated: (user: AuthUser) => void): AuthSubmit {
  const [error, setError] = useState<AuthFormError | null>(null)
  const [pending, setPending] = useState(false)

  const submit = async (request: () => Promise<AuthResult>): Promise<void> => {
    setError(null)
    setPending(true)
    try {
      const result = await request()
      if (result.ok) onAuthenticated(result.user)
      else setError(result.error)
    } catch {
      setError('unknown')
    } finally {
      setPending(false)
    }
  }

  return { error, pending, setError, submit }
}
