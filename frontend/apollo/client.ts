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

const errorLink = onError(({ graphQLErrors, networkError, operation, forward }) => {
  if (graphQLErrors) {
    graphQLErrors.forEach(({ message, locations, path, extensions }) =>
      console.log(
        `[GraphQL error]: Code: ${extensions?.code},  Message: ${message}, Location: ${locations}, Path: ${path}`
      )
    )
    for (let err of graphQLErrors) {
      toast.error(err.message)
    }
  }

  // Log network error
  if (networkError) {
    console.log(`[Network error]: ${networkError}`)
    // Client-side logout when recieving a 403 from the backend
    if (networkError.message.includes('403')) handleSignout()
  }
})

export const graphQlClient = new ApolloClient({
  link: from([errorLink, httpLink]),
  cache: new InMemoryCache(),
})
