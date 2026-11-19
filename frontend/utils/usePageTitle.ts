'use client'

import { useEffect } from 'react'

/**
 * Set `document.title` from the client. Next's streamed metadata overwrites
 * client-set titles on navigation, so the title is re-asserted on every change.
 */
export function usePageTitle(title: string) {
  useEffect(() => {
    if (!title) return

    const applyTitle = () => {
      if (document.title !== title) document.title = title
    }
    applyTitle()

    // Writing the title re-enters this callback once; the second pass matches
    // and writes nothing, so it settles rather than looping.
    const observer = new MutationObserver(applyTitle)
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    })
    return () => observer.disconnect()
  }, [title])
}
