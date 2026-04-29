import { HttpLink, ApolloClient, InMemoryCache, from } from '@apollo/client'
import crossFetch from 'cross-fetch'
import { onError } from '@apollo/client/link/error'
import { UrlUtils } from '@/utils/auth'
import { deleteDeviceKey, clearActivePasswordUser, getActivePasswordUser } from '@/utils/localStorage'
import axios from 'axios'
import { toast } from 'react-toastify'
import posthog from 'posthog-js'

export const handleSignout = async () => {
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
  try {
    await axios.post(
      UrlUtils.makeUrl(process.env.NEXT_PUBLIC_BACKEND_API_BASE!, 'logout'),
      {},
      { withCredentials: true }
    )
  } catch (e) {
    // Logout may fail if session is already expired — still redirect
  }
  window.location.href = '/login'
}

const httpLink = new HttpLink({
  uri: `${process.env.NEXT_PUBLIC_BACKEND_API_BASE}/graphql/`,
  credentials: 'include',
  fetch: crossFetch,
})

const errorLink = onError(({ graphQLErrors, networkError }) => {
  if (graphQLErrors) {
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

      // Default error handling (toast)
      toast.error(err.message)
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
  link: from([errorLink, httpLink]),
  cache: new InMemoryCache({
    typePolicies: {
      KeyMap: {
        keyFields: ['id', 'keyName'], // composite key
      },
    },
  }),
  defaultOptions: {
    watchQuery: {
      skipPollAttempt: () => document.hidden,
    },
  },
})
