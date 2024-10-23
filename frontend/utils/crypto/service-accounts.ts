import { newEnvWrapKey, newEnvToken } from "./environments";
import { getWrappedKeyShare } from "./general";
import { splitSecret } from "./keyshares";

/**
 * Generates a service account token.
 *
 * @param {string} serviceAccountId - The Service Account ID.
 * @param {{ publicKey: string; privateKey: string }} saKeyring - The service account keyring.
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

  const keyShares = await splitSecret(saKeyring.privateKey)
  const wrappedKeyShare = await getWrappedKeyShare(keyShares[1], wrapKey)

  const pssService = `pss_service:v2:${token}:${saKeyring.publicKey}:${keyShares[0]}:${wrapKey}`
  const mutationPayload = {
    serviceAccountId,
    name,
    identityKey: saKeyring.publicKey,
    token,
    wrappedKeyShare,
    expiry,
  }

  return {
    pssService,
    mutationPayload,
  }
}
