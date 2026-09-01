import { HttpLink, ApolloClient, InMemoryCache, from, ApolloLink, Observable } from '@apollo/client'
import type { FetchResult } from '@apollo/client'
import crossFetch from 'cross-fetch'
import { onError } from '@apollo/client/link/error'
import { setContext } from '@apollo/client/link/context'
import { UrlUtils } from '@/utils/auth'
import { isReauthError, reauthRedirectUrl, requestReauthPrompt } from '@/utils/accountErrors'
import {
  deleteDeviceKey,
  clearActivePasswordUser,
  getActivePasswordUser,
} from '@/utils/localStorage'
import axios from 'axios'
import { toast } from 'react-toastify'
import posthog from 'posthog-js'

let csrfTokenPromise: Promise<string> | null = null

// Fetch the CSRF token once and cache it. It's read from the response body (not
// document.cookie) because the reverse proxy marks cookies HttpOnly.
export const getCsrfToken = (): Promise<string> => {
  if (!csrfTokenPromise) {
    csrfTokenPromise = crossFetch(`${process.env.NEXT_PUBLIC_BACKEND_API_BASE}/auth/csrf/`, {
      credentials: 'include',
    })
      .then((res) => (res.ok ? res.json() : { csrfToken: '' }))
      .then((data) => {
        const token = data.csrfToken || ''
        // Never cache a failure — retry on the next call
        if (!token) csrfTokenPromise = null
        return token
      })
      .catch(() => {
        csrfTokenPromise = null // allow a retry on the next call
        return ''
      })
  }
  return csrfTokenPromise
}

// Drop the cached token and fetch a fresh one — needed after a login in
// another tab rotates the CSRF secret.
export const refreshCsrfToken = (): Promise<string> => {
  csrfTokenPromise = null
  return getCsrfToken()
}

// Warm the cache so the first request doesn't wait on an extra round trip.
// Browser-only: this module is also evaluated during SSR.
if (typeof window !== 'undefined') {
  getCsrfToken()
}

export const handleSignout = async () => {
  // Quiesce polls first — a poll tick racing the logout would 403.
  graphQlClient.stop()
  try {
    posthog.reset()
    // Drop the deviceKey for the active password user only. SSO users use
    // `phaseMemberDeviceKeys` and are unaffected. The userId is stashed by
    // UserProvider so this works for both manual logout and the auto-logout
    // path below when a session cookie expires.
    const activeUserId = getActivePasswordUser()
    if (activeUserId) {
      deleteDeviceKey(activeUserId)
      clearActivePasswordUser()
    }
    const postLogout = (token: string) =>
      axios.post(
        UrlUtils.makeUrl(process.env.NEXT_PUBLIC_BACKEND_API_BASE!, 'logout'),
        {},
        { withCredentials: true, headers: token ? { 'X-CSRFToken': token } : {} }
      )
    try {
      await postLogout(await getCsrfToken())
    } catch (e) {
      // 403 = stale token; retry once so the session actually ends server-side
      if (axios.isAxiosError(e) && e.response?.status === 403) {
        await postLogout(await refreshCsrfToken())
      } else {
        throw e
      }
    }
  } catch (e) {
    // Logout may fail if session is already expired — still redirect
  } finally {
    // Always navigate — the client above is stopped.
    window.location.href = '/login'
  }
}

const httpLink = new HttpLink({
  uri: `${process.env.NEXT_PUBLIC_BACKEND_API_BASE}/graphql/`,
  credentials: 'include',
  fetch: crossFetch,
})

// GraphQL mutations are CSRF-enforced — attach the token to every request.
const csrfLink = setContext(async (_, { headers }) => {
  const token = await getCsrfToken()
  return { headers: { ...headers, ...(token ? { 'X-CSRFToken': token } : {}) } }
})

// Retry once with a fresh token on a CSRF 403 (the secret rotates on login).
// Sits below errorLink so errors from the retried attempt still reach the
// global handlers — a retry returned from onError would bypass them.
const csrfRetryLink = new ApolloLink(
  (operation, forward) =>
    new Observable<FetchResult>((observer) => {
      let sub: { unsubscribe(): void } | undefined
      let retried = false
      const attempt = () => {
        sub = forward(operation).subscribe({
          next: (value) => observer.next(value),
          error: (err) => {
            const { statusCode, result } = (err ?? {}) as { statusCode?: number; result?: unknown }
            const bodyText = typeof result === 'string' ? result : JSON.stringify(result ?? '')
            if (!retried && statusCode === 403 && bodyText.includes('CSRF')) {
              retried = true
              refreshCsrfToken()
              attempt()
              return
            }
            observer.error(err)
          },
          complete: () => observer.complete(),
        })
      }
      attempt()
      return () => sub?.unsubscribe()
    })
)

const errorLink = onError(({ graphQLErrors, networkError, operation }) => {
  if (graphQLErrors) {
    // Operations whose components own their error toasts (account page
    // mutations) opt out of the global toast to avoid double-toasting.
    const { suppressGlobalErrorToast } = operation.getContext()

    for (let err of graphQLErrors) {
      const code = err.extensions?.code

      if (code === 'IP_RESTRICTED') {
        const org = err.extensions?.organisation_name

        window.location.href = `/ip-restricted?org=${org}`
        return
      }

      if (code === 'SSO_REQUIRED') {
        // Org requires SSO and the current session was not established via
        // the org's SSO flow. Send the user back to the lobby where the org
        // card surfaces the "Sign in with <provider>" prompt. Avoid a redirect
        // loop if we're already at the lobby.
        if (window.location.pathname !== '/') {
          window.location.href = '/'
        } else {
          toast.error(err.message)
        }
        return
      }

      if (code === 'REAUTH_REQUIRED' || isReauthError(err.message)) {
        // Fresh-session gate: own the handling here so every reauth-gated
        // mutation behaves the same (avoid a loop if already on /login).
        // The URL carries the interrupted dialog's state so the flow can
        // be restored after the re-login. Prefer the in-page prompt (the
        // user can back out); hard-redirect only when none is mounted.
        if (!window.location.pathname.startsWith('/login')) {
          const loginUrl = reauthRedirectUrl()
          if (!requestReauthPrompt(loginUrl)) window.location.href = loginUrl
        }
        return
      }

      // Default error handling (toast)
      if (!suppressGlobalErrorToast) toast.error(err.message)
      console.log(
        `[GraphQL error]: Code: ${code},  Message: ${err.message}, Location: ${err.locations}, Path: ${err.path}`
      )
    }
  }

  if (networkError) {
    console.log(`[Network error]: ${networkError}`)
    const publicPaths = ['/login', '/signup', '/lockbox']
    const isPublicPage = publicPaths.some((p) => window.location.pathname.startsWith(p))
    if (networkError.message.includes('403') && !isPublicPage) handleSignout()
  }
})

export const graphQlClient = new ApolloClient({
  connectToDevTools: process.env.NODE_ENV === 'development',
  link: from([errorLink, csrfRetryLink, csrfLink, httpLink]),
  cache: new InMemoryCache({
    typePolicies: {
      KeyMap: {
        keyFields: ['id', 'keyName'], // composite key
      },
      Query: {
        fields: {
          // Offset-based pagination for the audit log query. Without an
          // explicit keyArgs+merge, fetchMore's appending was merging into
          // the offset=0 cache entry via updateQuery, which left a stale
          // long array around when variables changed (tab switch) and
          // then changed back — the subsequent network-only refetch
          // didn't cleanly replace it.
          auditLogs: {
            keyArgs: [
              'organisationId',
              'start',
              'end',
              'resourceType',
              'resourceTypes',
              'resourceId',
              'eventTypes',
              'actorId',
            ],
            merge(existing, incoming, { args }) {
              const offset = (args?.offset as number | undefined) ?? 0
              // First page or refetch: replace.
              if (!existing || offset === 0) return incoming
              return {
                ...incoming,
                logs: [...(existing.logs || []), ...(incoming.logs || [])],
                count: incoming.count,
              }
            },
          },
        },
      },
    },
  }),
  defaultOptions: {
    watchQuery: {
      skipPollAttempt: () => document.hidden,
    },
  },
})
