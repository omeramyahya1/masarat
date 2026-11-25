// State kept for the browser tab's session (sessionStorage): a view's settings survive leaving
// the section and coming back, or a reload, but not a new tab
import { useState, type Dispatch, type SetStateAction } from 'react'

export function useSessionState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = sessionStorage.getItem(key)
      return saved ? (JSON.parse(saved) as T) : initial
    } catch {
      return initial
    }
  })
  const set: Dispatch<SetStateAction<T>> = (next) =>
    setValue((current) => {
      const value = typeof next === 'function' ? (next as (v: T) => T)(current) : next
      try {
        sessionStorage.setItem(key, JSON.stringify(value))
      } catch {
        // Storage may be unavailable; the value still applies until the section closes
      }
      return value
    })
  return [value, set]
}
