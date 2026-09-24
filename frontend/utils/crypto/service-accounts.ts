import _sodium from 'libsodium-wrappers-sumo'
import { graphQlClient } from "@/apollo/client";
import { newEnvWrapKey, newEnvToken } from "./environments";
import { decryptAsymmetric, encryptAsymmetric, getWrappedKeyShare } from "./general";
import { splitSecret } from "./keyshares";
import { GetServiceAccounts } from '@/graphql/queries/service-accounts/getServiceAccounts.gql'
import { GetServiceAccountHandlers } from '@/graphql/queries/service-accounts/getServiceAccountHandlers.gql'
import { UpdateServiceAccountHandlerKeys } from '@/graphql/mutations/service-accounts/updateHandlerKeys.gql'
import { GetServerKey } from '@/graphql/queries/syncing/getServerKey.gql'
import { OrganisationKeyring } from "./types";
import { OrganisationMemberType, ServiceAccountHandlerInput, ServiceAccountHandlerType, ServiceAccountType } from "@/apollo/graphql";
import { getUserKxPublicKey, getUserKxPrivateKey } from "./users";

/**
 * Signs service account token material with the SA Ed25519 private key so the
 * server can verify the token was minted by a keyring holder.
 *
 * @param {{ token: string; identityKey: string; wrappedKeyShare: string }} material - The token material to sign.
 * @param {string} signingPrivateKey - The SA Ed25519 private key as hex.
 * @returns {Promise<string>} - Hex encoded detached signature.
 */
export const signSATokenMaterial = async (
  material: { token: string; identityKey: string; wrappedKeyShare: string },
  signingPrivateKey: string
) => {
  await _sodium.ready
  const sodium = _sodium

  const message = `${material.token}:${material.identityKey}:${material.wrappedKeyShare}`

  return sodium.to_hex(
    sodium.crypto_sign_detached(sodium.from_string(message), sodium.from_hex(signingPrivateKey))
  )
}

/**
 * Generates a service account token.
 *
 * @param {string} serviceAccountId - The Service Account ID.
 * @param {{ publicKey: string; privateKey: string }} saKeyring - The service account Ed25519 signing keyring.
 * @param {string} name - The token name.
 * @param {number | null} expiry - Expiry timestamp in ms, or null for no expiry.
 * @returns {Promise<{ pssService: string; mutationPayload: object }>} - An object containing the user token and mutation payload.
 */
export const generateSAToken = async (
  serviceAccountId: string,
  saKeyring: { publicKey: string; privateKey: string },
  name: string,
  expiry: number | null
) => {
  const wrapKey = await newEnvWrapKey()
  const token = await newEnvToken()

  const saKxKeys = {
    publicKey: await getUserKxPublicKey(saKeyring.publicKey),
    privateKey: await getUserKxPrivateKey(saKeyring.privateKey),
  }

  const keyShares = await splitSecret(saKxKeys.privateKey)
  const wrappedKeyShare = await getWrappedKeyShare(keyShares[1], wrapKey)
  const identityKey = saKxKeys.publicKey
  const signature = await signSATokenMaterial(
    { token, identityKey, wrappedKeyShare },
    saKeyring.privateKey
  )

  const pssService = `pss_service:v2:${token}:${identityKey}:${keyShares[0]}:${wrapKey}`
  const mutationPayload = {
    serviceAccountId,
    name,
    identityKey,
    token,
    wrappedKeyShare,
    expiry,
    signature,
  }

  return {
    pssService,
    mutationPayload,
  }
}



/**
 * Updates the service account handlers for all service accounts in the organisation.
 * Fetches all service accounts, all handlers, and encrypts each account's keys for each handler.
 * The promise will resolve if the operation is successful or reject with an error message otherwise.
 * 
 * @param {string} orgId - The organisation ID.
 * @param {OrganisationKeyring} userKeyring - The current active user keyring.
 * @returns {Promise<string>}
 */
export const updateServiceAccountHandlers = async (orgId: string, userKeyring: OrganisationKeyring) => {
  return new Promise(async (resolve, reject) => {
    // Fetch service accounts
    const { data: serviceAccountsData } = await graphQlClient.query({ query: GetServiceAccounts, variables: { orgId }, fetchPolicy: 'network-only' })
    const serviceAccounts = serviceAccountsData?.serviceAccounts || []

    // Fetch service account handlers
    const { data: handlersData } = await graphQlClient.query({ query: GetServiceAccountHandlers, variables: { orgId }, fetchPolicy: 'network-only' })
    const handlers = handlersData.serviceAccountHandlers

    // Current user kx keys
    const userKxKeys = {
      publicKey: await getUserKxPublicKey(userKeyring.publicKey),
      privateKey: await getUserKxPrivateKey(userKeyring.privateKey),
    }
    
    let handlerInputs: ServiceAccountHandlerInput[] = [] 

    const handlerInputPromises = serviceAccounts.map(async (account: ServiceAccountType) => {

      // Get the account wrapped keys for the current user
      const selfHandler: ServiceAccountHandlerType | undefined = account.handlers?.find(
        (handler) => handler?.user.self === true
      ) ?? undefined

      // Skip accounts the current user can't unwrap:
      // - Team-owned SAs use server-side KMS and have no handlers
      // - Org-level SAs where the current user isn't a handler belong to someone else
      if (!selfHandler) return []

      // Unwrap the keyring and recovery for this account
      const serviceAccountKeyringString = await decryptAsymmetric(
        selfHandler.wrappedKeyring,
        userKxKeys.privateKey,
        userKxKeys.publicKey
      )

      const serviceAccountRecoveryString = await decryptAsymmetric(
        selfHandler.wrappedRecovery,
        userKxKeys.privateKey,
        userKxKeys.publicKey
      )

      // Wrap the keyring and recovery for each handler
      const handlerWrappingPromises = handlers.map(async (handler: OrganisationMemberType) => {

        const kxKey = await getUserKxPublicKey(handler.identityKey!)
        const wrappedKeyring = await encryptAsymmetric(serviceAccountKeyringString, kxKey)
        const wrappedRecovery = await encryptAsymmetric(serviceAccountRecoveryString, kxKey)
        return {
          serviceAccountId: account.id,
          memberId: handler.id,
          wrappedKeyring,
          wrappedRecovery,
        }
      })

      const handlerKeys = await Promise.all(handlerWrappingPromises)

      return handlerKeys // Return the result of this async operation
    })

    // Wait for all handler input promises to resolve and flatten the array
    const allHandlerInputs = await Promise.all(handlerInputPromises)
    handlerInputs = allHandlerInputs.flat() // Flatten the nested arrays

    
    const {data: result } = await graphQlClient.mutate({ mutation: UpdateServiceAccountHandlerKeys, variables: { orgId, handlers: handlerInputs }})
    if (result.updateServiceAccountHandlers.ok) resolve("Success")
      else reject("Failed to update service account handlers")

  })
  
}

/**
 * Wraps service account keyring and recovery for server-side encryption.
 * 
 * @param {string} keyringString - The service account keyring as JSON string
 * @param {string} recoveryString - The service account recovery/mnemonic string
 * @param {string} serverPublicKey - The server's public key for encryption
 * @returns {Promise<{ serverWrappedKeyring: string; serverWrappedRecovery: string }>}
 */
export const wrapServiceAccountSecretsForServer = async (
  keyringString: string,
  recoveryString: string,
  serverPublicKey: string
) => {
  const serverWrappedKeyring = await encryptAsymmetric(keyringString, serverPublicKey)
  const serverWrappedRecovery = await encryptAsymmetric(recoveryString, serverPublicKey)

  return {
    serverWrappedKeyring,
    serverWrappedRecovery,
  }
}

/**
 * Unwraps service account keyring and recovery for the current user.
 * 
 * @param {string} wrappedKeyring - The user-wrapped keyring
 * @param {string} wrappedRecovery - The user-wrapped recovery
 * @param {OrganisationKeyring} userKeyring - The current user's keyring
 * @returns {Promise<{ keyringString: string; recoveryString: string }>}
 */
export const unwrapServiceAccountSecretsForUser = async (
  wrappedKeyring: string,
  wrappedRecovery: string,
  userKeyring: OrganisationKeyring
) => {
  const userKxKeys = {
    publicKey: await getUserKxPublicKey(userKeyring.publicKey),
    privateKey: await getUserKxPrivateKey(userKeyring.privateKey),
  }

  const keyringString = await decryptAsymmetric(
    wrappedKeyring,
    userKxKeys.privateKey,
    userKxKeys.publicKey
  )

  const recoveryString = await decryptAsymmetric(
    wrappedRecovery,
    userKxKeys.privateKey,
    userKxKeys.publicKey
  )

  return {
    keyringString,
    recoveryString,
  }
}
