'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTopLoader } from 'nextjs-toploader'
import { clearPopStateGuard, setPopStateGuard } from '@/utils/navigationGuard'

const CONFIRM_MESSAGE =
  'You have made changes that have not been deployed yet. Are you sure you want to leave?'

/** Carries on with a navigation that was held back */
export type LeavePage = () => void

/**
 * Guards unsaved changes against leaving the page.
 *
 * Closing or reloading the tab, or leaving the site, can only get the browser's own prompt.
 * In-app navigation (links, back and forward) is held back instead: with `onLeave` it's
 * handed over to ask in the app's own UI (calling `leave` carries on); without, the
 * browser's confirm asks. Next.js has no hook to block navigation, so link clicks and
 * popstate (see utils/navigationGuard) are caught before the router sees them.
 */
export function useWarnIfUnsavedChanges(
  unsaved: boolean,
  onLeave?: (leave: LeavePage) => void
) {
  const loader = useTopLoader()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const onLeaveRef = useRef(onLeave)
  onLeaveRef.current = onLeave
  // Set while carrying on with a back/forward the user agreed to
  const allowPopRef = useRef(false)
  // This page's history entry, put back when a back/forward is held
  const entryRef = useRef<{ state: unknown; url: string } | null>(null)
  useEffect(() => {
    entryRef.current = { state: window.history.state, url: window.location.href }
  }, [pathname, searchParams])

  // Tab close or reload
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!unsaved) return
      e.preventDefault()
      e.returnValue = ''
      loader.done(true)
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [unsaved, loader])

  // Back/forward: by the time popstate fires the URL has moved, so a held navigation
  // stops the router's own listener (the guard runs before it) and puts this page's entry
  // back. Carrying on is then a plain step back: it lands on the entry that was asked
  // for, whichever way the user went.
  useEffect(() => {
    if (!unsaved) return
    // A step back that went ahead after the guard came down isn't waiting any more
    allowPopRef.current = false

    const guard = (e: PopStateEvent) => {
      if (allowPopRef.current) {
        allowPopRef.current = false
        return
      }
      const entry = entryRef.current
      const hold = () => {
        e.stopImmediatePropagation()
        // With the router's own state, its patched pushState passes this straight through
        if (entry) window.history.pushState(entry.state, '', entry.url)
        loader.done(true)
      }
      const ask = onLeaveRef.current
      if (ask) {
        hold()
        ask(() => {
          allowPopRef.current = true
          window.history.back()
        })
      } else if (!confirm(CONFIRM_MESSAGE)) hold()
    }

    setPopStateGuard(guard)
    return () => clearPopStateGuard(guard)
  }, [unsaved, loader])

  // Links (<Link> or any <a href>) to another page of the app; caught in the capture
  // phase, before the router's own click handling
  useEffect(() => {
    if (!unsaved) return

    const handleClick = (e: MouseEvent) => {
      // New tabs and windows leave this page as it is
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return
      const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.hasAttribute('download')) return
      if (anchor.target && anchor.target !== '_self') return

      const url = new URL(anchor.href, window.location.href)
      // Another site is left through beforeunload; the same page (a hash, say) isn't left
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname && url.search === window.location.search) return

      const hold = () => {
        e.preventDefault()
        e.stopImmediatePropagation()
        loader.done(true)
      }
      const ask = onLeaveRef.current
      if (ask) {
        hold()
        ask(() => router.push(`${url.pathname}${url.search}${url.hash}`))
      } else if (!confirm(CONFIRM_MESSAGE)) hold()
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [unsaved, loader, router])
}
