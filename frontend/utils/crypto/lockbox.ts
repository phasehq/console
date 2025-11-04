import _sodium from 'libsodium-wrappers-sumo'
import { encryptAsymmetric, decryptAsymmetric } from './general'

/**
 * Create a random seed for a new lockbox
 *
 * @returns {Promise<string>} - hex encoded lockbox seed
 */
export const newBoxSeed = async () => {
  await _sodium.ready
  const sodium = _sodium

  const seed = sodium.crypto_kdf_keygen()
  return sodium.to_hex(seed)
}
/**
 * Encrypts data using an asymmetric encryption with a randomly generated key pair.
 *
 * @param {string} data - The data to be encrypted
 * @param {string} seed - The seed used to generate the reciever key pair
 *
 * @returns {string} - The encrypted data as a JSON string
 */
export const encryptBox = async (data: string, seed: string) => {
  await _sodium.ready
  const sodium = _sodium

  const { publicKey } = sodium.crypto_kx_seed_keypair(sodium.from_hex(seed))

  const ciphertext = await encryptAsymmetric(data, sodium.to_hex(publicKey))

  return JSON.stringify({ data: ciphertext })
}

/**
 * Decrypts the given boxData using keys derived from the given seed
 *
 * @param {string} boxData - encrypted box data
 * @param {string} seed - hex encoded lockbox seed
 *
 * @returns {Promise<string>} - The decrypted data as a JSON string
 */
export const decryptBox = async (boxData: string, seed: string) => {
  await _sodium.ready
  const sodium = _sodium

  const encryptedData = boxData

  const { publicKey, privateKey } = sodium.crypto_kx_seed_keypair(sodium.from_hex(seed))

  const plaintext = await decryptAsymmetric(
    encryptedData,
    sodium.to_hex(privateKey),
    sodium.to_hex(publicKey)
  )

  return plaintext
}
