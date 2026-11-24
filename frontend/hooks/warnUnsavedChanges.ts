'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTopLoader } from 'nextjs-toploader'
import {
  clearLeaveGuard,
  clearPopStateGuard,
  setLeaveGuard,
  setPopStateGuard,
} from '@/utils/navigationGuard'

const CONFIRM_MESSAGE =
  'You have made changes that have not been deployed yet. Are you sure you want to leave?'

/** Carries on with a navigation that was held back */
export type LeavePage = () => void

type HistoryPosition = { navigation?: { currentEntry?: { index: number } | null } }

/** The current entry's place in the tab's history, where the browser tells (the Navigation API) */
const historyIndex = () => {
  const index = (window as Window & HistoryPosition).navigation?.currentEntry?.index
  return typeof index === 'number' && index >= 0 ? index : null
}

/** Next.js can't block navigation, so links and popstate are caught before its router sees them */
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
  // Set while the browser steps back to this page's entry after a back/forward was held
  const returningRef = useRef(false)
  // This page's history entry, put back when a back/forward is held
  const entryRef = useRef<{ state: unknown; url: string; index: number | null } | null>(null)
  useEffect(() => {
    entryRef.current = {
      state: window.history.state,
      url: window.location.href,
      index: historyIndex(),
    }
  }, [pathname, searchParams])

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

  useEffect(() => {
    if (!unsaved) return
    // A step back that went ahead after the guard came down isn't waiting any more
    allowPopRef.current = false
    // The entry the changes are made on: a hash may have added one for this same page since
    if (entryRef.current) entryRef.current.index = historyIndex()

    const guard = (e: PopStateEvent) => {
      const entry = entryRef.current
      const at = historyIndex()
      // How far the browser went from this page's entry, where it tells
      const steps = entry && entry.index !== null && at !== null ? at - entry.index : null
      if (steps === 0 && returningRef.current) {
        // Back on this page's entry: the router never saw it leave
        returningRef.current = false
        e.stopImmediatePropagation()
        return
      }
      if (allowPopRef.current) {
        allowPopRef.current = false
        return
      }
      const hold = () => {
        e.stopImmediatePropagation()
        if (steps) {
          // Stepping back to this entry keeps the ones ahead of it, which pushing it again would drop
          returningRef.current = true
          window.history.go(-steps)
        } else if (entry) {
          // With the router's own state, its patched pushState passes this straight through
          window.history.pushState(entry.state, '', entry.url)
        }
        loader.done(true)
      }
      const ask = onLeaveRef.current
      if (ask) {
        hold()
        ask(() => {
          allowPopRef.current = true
          if (steps) window.history.go(steps)
          // From the entry pushed again, one step back is where the user was heading, either way
          else window.history.back()
        })
      } else if (!confirm(CONFIRM_MESSAGE)) hold()
    }

    setPopStateGuard(guard)
    return () => clearPopStateGuard(guard)
  }, [unsaved, loader])

  // Navigation made in code (the command palette) asks here first: a push can't be held once made
  useEffect(() => {
    if (!unsaved) return

    const guard = (href: string, go: () => void) => {
      const url = new URL(href, window.location.href)
      if (url.origin !== window.location.origin) return false
      if (url.pathname === window.location.pathname && url.search === window.location.search)
        return false
      const ask = onLeaveRef.current
      if (!ask) return !confirm(CONFIRM_MESSAGE)
      ask(go)
      return true
    }

    setLeaveGuard(guard)
    return () => clearLeaveGuard(guard)
  }, [unsaved])

  // Capture phase, ahead of the router's own click handling
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
