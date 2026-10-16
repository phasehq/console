import { useContext } from 'react'
import { useMutation } from '@apollo/client'
import { KeyringContext } from '@/contexts/keyringContext'
import { CreateNewUserToken } from '@/graphql/mutations/users/createUserToken.gql'
import { GetUserTokens } from '@/graphql/queries/users/getUserTokens.gql'
import { generateUserToken, getUserKxPrivateKey, getUserKxPublicKey } from '@/utils/crypto'

/** Creates a personal access token for the current user from their unlocked keyring. */
export const useCreateUserToken = (organisationId: string) => {
  const { keyring } = useContext(KeyringContext)
  const [createUserToken] = useMutation(CreateNewUserToken)

  const createToken = async (name: string, expiry: number | null) => {
    if (!keyring) throw new Error('Keyring is locked')

    const userKxKeys = {
      publicKey: await getUserKxPublicKey(keyring.publicKey),
      privateKey: await getUserKxPrivateKey(keyring.privateKey),
    }

    const { pssUser, mutationPayload } = await generateUserToken(
      organisationId,
      userKxKeys,
      name,
      expiry
    )

    await createUserToken({
      variables: mutationPayload,
      refetchQueries: [
        {
          query: GetUserTokens,
          variables: {
            organisationId,
          },
        },
      ],
    })

    return { cliToken: pssUser, apiToken: `User ${mutationPayload.token}` }
  }

  return { createToken, keyringLocked: !keyring }
}
