'use client'

import { useEffect } from 'react'
import { useTopLoader } from 'nextjs-toploader'

export function useWarnIfUnsavedChanges(unsaved: boolean) {
  const loader = useTopLoader()

  const CONFIRM_MESSAGE =
    'You have made changes that have not been deployed yet. Are you sure you want to leave?'

  // Prevent tab close or reload
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

  // Prevent back/forward nav
  useEffect(() => {
    if (!unsaved) return

    const handlePopState = (e: PopStateEvent) => {
      const confirmLeave = confirm(CONFIRM_MESSAGE)
      if (!confirmLeave) {
        history.pushState(null, '', window.location.href)
        loader.done(true)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [unsaved, loader])

  // Intercept <Link> clicks (and any <a> with href)
  useEffect(() => {
    if (!unsaved) return

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const anchor = target.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return

      const href = anchor.href
      const current = window.location.href

      // Internal navigation only
      const isInternal = href.startsWith(location.origin) && href !== current
      if (!isInternal) return

      const confirmed = confirm(CONFIRM_MESSAGE)
      if (!confirmed) {
        e.preventDefault()
        e.stopImmediatePropagation()
        loader.done(true)
      }
    }

    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [unsaved, loader])
}
