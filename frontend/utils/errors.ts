import { ApolloError } from '@apollo/client'
import { toast } from 'react-toastify'

/**
 * True when the error carries GraphQL errors, which the global Apollo errorLink
 * already toasts. Network errors and client-side rejections are not covered and
 * must be surfaced by the caller.
 */
export const isHandledGraphQLError = (error: unknown): boolean =>
  error instanceof ApolloError && error.graphQLErrors.length > 0

/** Toast an error unless the global Apollo errorLink has already shown it. */
export const toastUnhandledError = (error: unknown, fallback: string) => {
  if (isHandledGraphQLError(error)) return
  toast.error(error instanceof Error ? error.message : fallback)
}
