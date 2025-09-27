import { DynamicSecretType } from '@/apollo/graphql'
import { decryptAsymmetric } from '@/utils/crypto'

/**
 * Decrypts dynamic secret key names in keyMap.
 *
 * @param {DynamicSecretType[]} encryptedDynamicSecrets - An array of encrypted dynamic secrets.
 * @param {{ publicKey: string; privateKey: string }} envKeys - The environment keys for decryption.
 * @returns {Promise<DynamicSecretType[]>} - An array of dynamic secrets with decrypted keyNames.
 */
export const decryptDynamicSecretKeyNames = async (
  encryptedDynamicSecrets: DynamicSecretType[],
  envKeys: { publicKey: string; privateKey: string }
) => {
  return Promise.all(
    encryptedDynamicSecrets.map(async (dynamicSecret) => {
      const decryptedDynamicSecret = structuredClone(dynamicSecret)

      if (dynamicSecret.keyMap) {
        decryptedDynamicSecret.keyMap = await Promise.all(
          dynamicSecret.keyMap.map(async (keyMapEntry) => {
            if (!keyMapEntry) return keyMapEntry
            return {
              ...keyMapEntry,
              keyName: keyMapEntry.keyName
                ? await decryptAsymmetric(
                    keyMapEntry.keyName,
                    envKeys.privateKey,
                    envKeys.publicKey
                  )
                : keyMapEntry.keyName,
            }
          })
        )
      }

      return decryptedDynamicSecret
    })
  )
}
