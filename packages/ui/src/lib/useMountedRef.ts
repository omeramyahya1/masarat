import { useEffect, useRef, type RefObject } from 'react'

// True while the component is mounted. Lets async handlers drop results that arrive after the
// user has left (e.g. closed the dialog), so a stale request can't act on a newer instance.
export function useMountedRef(): RefObject<boolean> {
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return (): void => {
      mounted.current = false
    }
  }, [])
  return mounted
}
