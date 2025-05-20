import { ProviderType } from '@/apollo/graphql'
import { encryptAsymmetric } from '../crypto'

export interface Crdentials {
  [key: string]: string | null | undefined
}

export const encryptProviderCredentials = async (
  provider: ProviderType,
  credentials: Crdentials,
  serverKey: string
) => {
  if (provider?.expectedCredentials && serverKey) {
    // Create a deep copy of credentials
    const credentialsCopy = structuredClone(credentials)

    const providerCredentials = [...provider.expectedCredentials, ...provider.optionalCredentials]

    // Encrypt only defined values
    const encryptionPromises = providerCredentials.map(async (credential) => {
      const value = credentials[credential]
      if (value != null) {
        credentialsCopy[credential] = await encryptAsymmetric(value, serverKey)
      } else {
        credentialsCopy[credential] = value // preserve null or undefined
      }
    })

    await Promise.all(encryptionPromises)

    return credentialsCopy
  }
}

export const isCredentialSecret = (credential: string) =>
  !/(?:addr|host)/i.test(credential.toLowerCase())
