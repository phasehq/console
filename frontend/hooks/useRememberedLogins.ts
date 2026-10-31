import { useMemo, useSyncExternalStore } from 'react'
import {
  parseRememberedLogins,
  readRememberedLoginsSnapshot,
  subscribeToRememberedLogins,
} from '@/utils/lastLogin'

// Nothing is remembered on the server; the client snapshot takes over right
// after hydration.
const getServerSnapshot = () => null

/** Accounts that signed in on this browser, most recent first. Stays in sync
 *  with changes made in this tab and others. */
export const useRememberedLogins = () => {
  const raw = useSyncExternalStore(
    subscribeToRememberedLogins,
    readRememberedLoginsSnapshot,
    getServerSnapshot
  )
  return useMemo(() => parseRememberedLogins(raw), [raw])
}
