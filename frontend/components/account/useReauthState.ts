'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { buildReauthUrl, registerReauthState, requestReauthPrompt } from '@/utils/accountErrors'
import { useUser } from '@/contexts/userContext'

// While `active` (dialog open), publishes this flow's restorable state for
// the reauth redirect. getState is read through a ref, so the captured state
// is always current at redirect time. Never include passwords or codes.
export const useReauthStateSync = (active: boolean, getState: () => Record<string, string>) => {
  const getStateRef = useRef(getState)
  getStateRef.current = getState

  useEffect(() => {
    if (!active) return
    return registerReauthState(() => getStateRef.current())
  }, [active])
}

// Client-side view of the freshness gate (authFreshUntil from /auth/me).
// Advisory only — the server re-checks every mutation. Unknown reads as fresh.
export const useSessionFresh = () => {
  const { user } = useUser()
  const authFreshUntil = user?.authFreshUntil

  const isFresh = useCallback(() => {
    if (authFreshUntil === undefined) return true
    return authFreshUntil !== null && Date.now() / 1000 < authFreshUntil
  }, [authFreshUntil])

  return { isFresh }
}

// Click-time gate for a reauth-protected flow: true = proceed, false = the
// confirm-first prompt is up, wired to a restore URL built from `state`.
export const useReauthGuard = (state: Record<string, string>) => {
  const { isFresh } = useSessionFresh()
  const stateRef = useRef(state)
  stateRef.current = state

  return useCallback(() => {
    if (isFresh()) return true
    const qs = new URLSearchParams(stateRef.current).toString()
    return !requestReauthPrompt(buildReauthUrl(`/account?${qs}`))
  }, [isFresh])
}

// Restores an interrupted flow after the reauth round trip. When the URL
// carries ?action=<action>, calls onRestore with the params once `ready`,
// then strips the params so a refresh doesn't re-trigger the restore.
// Reads window.location directly (not useSearchParams) — this runs client-
// side only and needs no Suspense boundary.
export const useReauthRestore = (
  action: string,
  onRestore: (params: URLSearchParams) => void,
  ready: boolean = true
) => {
  const router = useRouter()
  const restoredRef = useRef(false)
  const onRestoreRef = useRef(onRestore)
  onRestoreRef.current = onRestore

  useEffect(() => {
    if (!ready || restoredRef.current) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('action') !== action) return
    restoredRef.current = true
    onRestoreRef.current(params)
    router.replace('/account')
  }, [ready, action, router])
}
