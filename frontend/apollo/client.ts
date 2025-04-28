import { HttpLink, ApolloClient, InMemoryCache, from } from '@apollo/client'
import crossFetch from 'cross-fetch'
import { onError } from '@apollo/client/link/error'
import { signOut, SignOutParams } from 'next-auth/react'
import { UrlUtils } from '@/utils/auth'
import axios from 'axios'
import { toast } from 'react-toastify'
import posthog from 'posthog-js'

export const handleSignout = async (options?: SignOutParams<true> | undefined) => {
  posthog.reset()
  const response = await axios.post(
    UrlUtils.makeUrl(process.env.NEXT_PUBLIC_BACKEND_API_BASE!, 'logout'),
    {},
    { withCredentials: true }
  )
  signOut(options)
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

      // Default error handling (toast)
      toast.error(err.message)
      console.log(
        `[GraphQL error]: Code: ${code},  Message: ${err.message}, Location: ${err.locations}, Path: ${err.path}`
      )
    }
  }

  if (networkError) {
    console.log(`[Network error]: ${networkError}`)
    if (networkError.message.includes('403')) handleSignout()
  }
})

export const graphQlClient = new ApolloClient({
  link: from([errorLink, httpLink]),
  cache: new InMemoryCache(),
  defaultOptions: {
    watchQuery: {
      skipPollAttempt: () => document.hidden,
    },
  },
})
