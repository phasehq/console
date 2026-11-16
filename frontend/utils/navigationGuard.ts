// Installed at load: window runs popstate listeners in the order added, and the router adds its own on mount
type PopStateGuard = (event: PopStateEvent) => void
/** True if it took the navigation over, to carry on with `go` once the user agrees */
type LeaveGuard = (href: string, go: () => void) => boolean

let guard: PopStateGuard | null = null
let leaveGuard: LeaveGuard | null = null
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

/** Set (or clear, with null) what the page asks before a navigation made in code */
export const setLeaveGuard = (next: LeaveGuard | null) => {
  leaveGuard = next
}

/** Clears the guard only if it's still this one (a newer page may have set its own) */
export const clearLeaveGuard = (current: LeaveGuard) => {
  if (leaveGuard === current) leaveGuard = null
}

/** For `router.push` and the like, which no click or popstate guard sees: `go` runs once the page lets it */
export const navigateGuarded = (href: string, go: () => void) => {
  if (!leaveGuard?.(href, go)) go()
}
