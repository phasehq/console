import { ProviderType } from '@/apollo/graphql'
import { encryptAsymmetric } from '../crypto'

export interface Crdentials {
  [key: string]: string
}

export const encryptProviderCredentials = async (
  provider: ProviderType,
  credentials: Crdentials,
  serverKey: string
) => {
  if (provider?.expectedCredentials && serverKey) {
    // Create a deep copy of credentials
    const credentialsCopy = structuredClone(credentials)

    // Create a list of promises for each credential encryption
    const encryptionPromises = provider.expectedCredentials.map(async (credential) => {
      credentialsCopy[credential] = await encryptAsymmetric(credentials[credential], serverKey)
    })

    // Wait for all promises to resolve
    await Promise.all(encryptionPromises)

    return credentialsCopy
  }
}
