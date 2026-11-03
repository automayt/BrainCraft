import { useEffect, useState } from 'react'

/** Whether a media query matches now, kept up to date (false where there is no window). */
export function useMedia(query: string): boolean {
  const get = () => typeof matchMedia !== 'undefined' && matchMedia(query).matches
  const [on, setOn] = useState(get)
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const m = matchMedia(query)
    const changed = () => setOn(m.matches)
    changed()
    m.addEventListener('change', changed)
    return () => m.removeEventListener('change', changed)
  }, [query])
  return on
}
