// Installed at load: window runs popstate listeners in the order added, and the router adds its own on mount
type PopStateGuard = (event: PopStateEvent) => void

let guard: PopStateGuard | null = null
let installed = false

/** Call as early as the app loads, before the router mounts */
export const installPopStateGuard = () => {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('popstate', (event) => guard?.(event))
}

/** Set (or clear, with null) the page's guard; it can stop the router seeing the event */
export const setPopStateGuard = (next: PopStateGuard | null) => {
  guard = next
}

/** Clears the guard only if it's still this one (a newer page may have set its own) */
export const clearPopStateGuard = (current: PopStateGuard) => {
  if (guard === current) guard = null
}
