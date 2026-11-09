/**
 * Back/forward for pages that guard unsaved changes.
 *
 * Browsers run popstate listeners on window in the order they were added (capture or not),
 * and Next.js adds its own when its router mounts, so a page's listener comes too late to
 * stop it. This one is added as the app's code loads (by the root providers), runs first,
 * and hands the event to the page that has set a guard.
 */
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
