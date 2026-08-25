'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { registerReauthState } from '@/utils/accountErrors'
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

// Client-side view of the server's session-freshness gate, from the
// authFreshUntil deadline on /auth/me. Advisory only (clock skew, and the
// server re-checks every mutation): `fresh` is reactive so an open dialog's
// stale-session hint appears when the deadline passes; `isFresh()` gives
// the live answer for click-time pre-checks. Unknown (user still loading,
// or a backend without the field) reads as fresh — never a false alarm.
export const useSessionFresh = () => {
  const { user } = useUser()
  const authFreshUntil = user?.authFreshUntil

  const isFresh = useCallback(() => {
    if (authFreshUntil === undefined) return true
    return authFreshUntil !== null && Date.now() / 1000 < authFreshUntil
  }, [authFreshUntil])

  const [fresh, setFresh] = useState(isFresh)

  useEffect(() => {
    setFresh(isFresh())
    const id = setInterval(() => setFresh(isFresh()), 30_000)
    return () => clearInterval(id)
  }, [isFresh])

  return { fresh, isFresh }
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
