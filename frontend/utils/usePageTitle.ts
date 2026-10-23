'use client'

import { useEffect } from 'react'

/**
 * Own `document.title` from the client.
 *
 * Titles here are computed from client context (org, app and environment names
 * that the route segments alone do not carry), so they cannot come from Next
 * `metadata` exports. Next still renders each route's metadata inside its own
 * streamed MetadataBoundary, which commits *after* React's passive effects and
 * overwrites whatever we set — with the root layout's bare "Phase Console" for
 * any route that declares no metadata of its own. `htmlLimitedBots` in
 * next.config.js only makes the *initial document* block on metadata, which is
 * why a hard refresh looks right while every client-side navigation is
 * clobbered.
 *
 * So rather than set the title once and hope we ran last, re-assert it whenever
 * something else changes it.
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
