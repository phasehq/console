// Crypto utils used for KMS

import _sodium from 'libsodium-wrappers-sumo'
import { encryptRaw, decryptRaw } from './general'
import { AppKeyring } from './types'

/**
 * Create a random seed for a new app
 *
 * @returns {Promise<string>} - hex encoded app seed
 */
export const newAppSeed = async () => {
  await _sodium.ready
  const sodium = _sodium

  const seed = sodium.crypto_kdf_keygen()
  return sodium.to_hex(seed)
}

/**
 * Create a random token for a new app
 *
 * @returns {Promise<string>} - hex encoded app token
 */
export const newAppToken = async () => {
  await _sodium.ready
  const sodium = _sodium

  const token = sodium.crypto_kdf_keygen()
  return sodium.to_hex(token)
}

/**
 * Create a wrapping key for new app
 *
 * @returns {Promise<string>} - hex encoded wrapping key
 */
export const newAppWrapKey = async () => {
  await _sodium.ready
  const sodium = _sodium

  const key = sodium.crypto_kdf_keygen()
  return sodium.to_hex(key)
}

/**
 * Encrypts an app seed with the given key
 *
 * @param seed - App seed as a hex string
 * @param key - Encryption key as a hex string
 * @returns {Promise<Uint8Array>}
 */
export const encryptAppSeed = async (seed: string, key: string) => {
  await _sodium.ready
  const sodium = _sodium

  const keyBytes = sodium.from_hex(key)
  const encryptedSeed = await encryptRaw(seed, keyBytes)
  return sodium.to_hex(encryptedSeed)
}

/**
 * Decrypts an app seed with the given key
 *
 * @param encryptedSeed - Encrytped app seed as a hex string
 * @param key - Decryption key as a hex string
 * @returns {Promise<string>} - hex encoded plaintext app seed
 */
export const decryptAppSeed = async (encryptedSeed: string, key: string) => {
  await _sodium.ready
  const sodium = _sodium

  const ciphertextBytes = sodium.from_hex(encryptedSeed)
  const keyBytes = sodium.from_hex(key)

  const seedBytes = await decryptRaw(ciphertextBytes, keyBytes)
  return sodium.to_string(seedBytes)
}

/**
 * Derives an app keyring from the given seed
 *
 * @param {string} appSeed - App seed as a hex string
 * @returns {Promise<AppKeyring>}
 */
export const appKeyring = async (appSeed: string): Promise<AppKeyring> => {
  await _sodium.ready
  const sodium = _sodium

  const seedBytes = sodium.from_hex(appSeed)
  const appKeypair = sodium.crypto_kx_seed_keypair(seedBytes)

  const { publicKey, privateKey } = appKeypair

  return { publicKey: sodium.to_hex(publicKey), privateKey: sodium.to_hex(privateKey) }
}
