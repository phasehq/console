import { useContext } from 'react'
import { useMutation } from '@apollo/client'
import { ServiceAccountType } from '@/apollo/graphql'
import { KeyringContext } from '@/contexts/keyringContext'
import { organisationContext } from '@/contexts/organisationContext'
import { CreateSAToken } from '@/graphql/mutations/service-accounts/createServiceAccountToken.gql'
import { CreateServerSideSAToken } from '@/graphql/mutations/service-accounts/createServerSideServiceAccountToken.gql'
import { GetServiceAccountTokens } from '@/graphql/queries/service-accounts/getServiceAccountTokens.gql'
import {
  decryptAsymmetric,
  getUserKxPrivateKey,
  getUserKxPublicKey,
  OrganisationKeyring,
} from '@/utils/crypto'
import { generateSAToken } from '@/utils/crypto/service-accounts'

/**
 * Creates service account tokens. Handlers mint them client-side from the account's keyring;
 * otherwise accounts with server-side key management mint them on the server.
 */
export const useCreateServiceAccountToken = (
  serviceAccount?: Pick<
    ServiceAccountType,
    'id' | 'handlers' | 'serverSideKeyManagementEnabled'
  > | null
) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { keyring } = useContext(KeyringContext)

  const [createClientSideToken] = useMutation(CreateSAToken)
  // The response carries the token itself, so keep it out of the Apollo cache.
  const [createServerSideToken] = useMutation(CreateServerSideSAToken, { fetchPolicy: 'no-cache' })

  const serviceAccountHandler = serviceAccount?.handlers?.find(
    (handler) => handler?.user.self === true
  )

  const canUseClientSide = !!serviceAccountHandler && !!keyring
  const canUseServerSide = serviceAccount?.serverSideKeyManagementEnabled === true

  const createToken = async (name: string, expiry: number | null) => {
    if (!serviceAccount) throw new Error('Service account not loaded')

    const refetchQueries = [
      {
        query: GetServiceAccountTokens,
        variables: {
          orgId: organisation!.id,
          id: serviceAccount.id,
        },
      },
    ]

    if (canUseClientSide) {
      const wrappedKeyring = serviceAccountHandler!.wrappedKeyring

      const userKxKeys = {
        publicKey: await getUserKxPublicKey(keyring!.publicKey),
        privateKey: await getUserKxPrivateKey(keyring!.privateKey),
      }

      const serviceAccountKeyringString = await decryptAsymmetric(
        wrappedKeyring,
        userKxKeys.privateKey,
        userKxKeys.publicKey
      )

      const serviceAccountKeys = JSON.parse(serviceAccountKeyringString) as OrganisationKeyring

      const { pssService, mutationPayload } = await generateSAToken(
        serviceAccount.id,
        serviceAccountKeys,
        name,
        expiry
      )

      await createClientSideToken({ variables: mutationPayload, refetchQueries })

      return { cliToken: pssService, apiToken: `ServiceAccount ${mutationPayload.token}` }
    }

    if (canUseServerSide) {
      const result = await createServerSideToken({
        variables: {
          serviceAccountId: serviceAccount.id,
          name,
          expiry,
        },
        refetchQueries,
      })

      const tokenString = result.data.createServerSideServiceAccountToken.tokenString
      const tokenValue = tokenString.split(':')[2]

      return { cliToken: tokenString as string, apiToken: `ServiceAccount ${tokenValue}` }
    }

    throw new Error(
      'Cannot create token: you are not a handler for this service account and server-side key management is not enabled.'
    )
  }

  return { canUseClientSide, canUseServerSide, createToken }
}
