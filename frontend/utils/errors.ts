import { ApolloError } from '@apollo/client'

/**
 * True when the error carries GraphQL errors, which the global Apollo errorLink
 * already toasts. Network errors and client-side rejections are not covered and
 * must be surfaced by the caller.
 */
export const isHandledGraphQLError = (error: unknown): boolean =>
  error instanceof ApolloError && error.graphQLErrors.length > 0
