'use client'

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import axios from 'axios'
import { UrlUtils } from '@/utils/auth'

interface UserData {
  userId: string
  email: string
  fullName: string
  avatarUrl: string | null
  authMethod: 'password' | 'sso'
}

interface UserContextValue {
  user: UserData | null
  loading: boolean
  error: boolean
  refetch: () => Promise<void>
}

const UserContext = createContext<UserContextValue>({
  user: null,
  loading: true,
  error: false,
  refetch: async () => {},
})

const PUBLIC_PATHS = ['/login', '/signup', '/lockbox']

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [authError, setAuthError] = useState(false)
  const pathname = usePathname()

  const fetchUser = useCallback(async () => {
    try {
      const response = await axios.get(
        UrlUtils.makeUrl(process.env.NEXT_PUBLIC_BACKEND_API_BASE!, 'auth', 'me'),
        { withCredentials: true }
      )
      setUser(response.data)
      setError(false)
      setAuthError(false)
    } catch (e) {
      setUser(null)
      setError(true)
      // Only treat 401/403 as an expired session. Transient 5xx errors,
      // network hiccups, or deploy restarts should not force logout.
      const status = axios.isAxiosError(e) ? e.response?.status : undefined
      setAuthError(status === 401 || status === 403)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  // Redirect to login if session cookie is stale/invalid.
  // The middleware lets the request through (cookie exists), but /auth/me/
  // returned 401/403 (session expired server-side). Without this, the user
  // sees a broken page until a GraphQL call triggers Apollo's error handler.
  useEffect(() => {
    if (!loading && authError && !PUBLIC_PATHS.some((p) => pathname?.startsWith(p))) {
      const currentPath = window.location.pathname + window.location.search
      if (currentPath && currentPath !== '/') {
        window.location.href = `/login?callbackUrl=${encodeURIComponent(currentPath)}`
      } else {
        window.location.href = '/login'
      }
    }
  }, [loading, authError, pathname])

  return (
    <UserContext.Provider value={{ user, loading, error, refetch: fetchUser }}>
      {children}
    </UserContext.Provider>
  )
}

/**
 * Drop-in replacement for useSession().
 *
 * Returns `{ user, loading, error }` where `user` has:
 *   - email, fullName, avatarUrl, authMethod, userId
 *
 * For compatibility with code that used `session?.user?.email` etc.,
 * a convenience `session` shape is also provided.
 */
export function useUser() {
  return useContext(UserContext)
}

/**
 * Compatibility shim for code that used `useSession()` from NextAuth.
 * Returns `{ data: session, status }` where session.user has name/email/image.
 * Uses useMemo to return stable references and prevent infinite re-render loops
 * when used as a useEffect dependency.
 */
export function useSession() {
  const { user, loading } = useContext(UserContext)

  const session = useMemo(
    () =>
      user
        ? {
            user: {
              name: user.fullName,
              email: user.email,
              image: user.avatarUrl,
            },
          }
        : null,
    [user?.fullName, user?.email, user?.avatarUrl]
  )

  const status: 'loading' | 'authenticated' | 'unauthenticated' = loading
    ? 'loading'
    : user
      ? 'authenticated'
      : 'unauthenticated'

  return { data: session, status }
}
