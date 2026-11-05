import { ApolloError } from '@apollo/client'
import { GraphQLError } from 'graphql'
import { toast } from 'react-toastify'
import { toastUnhandledError } from '@/utils/errors'

jest.mock('react-toastify', () => ({ toast: { error: jest.fn() } }))

describe('toastUnhandledError', () => {
  afterEach(() => jest.clearAllMocks())

  test('leaves GraphQL errors to the global error toast', () => {
    toastUnhandledError(
      new ApolloError({ graphQLErrors: [new GraphQLError('Agent not found')] }),
      'Fallback'
    )

    expect(toast.error).not.toHaveBeenCalled()
  })

  test('shows network and client errors once', () => {
    toastUnhandledError(new Error('Network request failed'), 'Fallback')
    toastUnhandledError('unknown', 'Fallback')

    expect(toast.error).toHaveBeenNthCalledWith(1, 'Network request failed')
    expect(toast.error).toHaveBeenNthCalledWith(2, 'Fallback')
  })
})
