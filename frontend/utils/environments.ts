import _sodium from 'libsodium-wrappers-sumo'
import { cryptoUtils } from '@/utils/auth'
import { splitSecret } from './keyshares'
import { EnvironmentKeyType, EnvironmentType } from '@/apollo/graphql'
import { decryptAsymmetric } from './crypto'

type EnvKeyring = {
  publicKey: string
  privateKey: string
}

/**
 * Create a random seed for a new env
 *
 * @returns {Promise<string>} - hex encoded env seed
 */
export const newEnvSeed = async () => {
  await _sodium.ready
  const sodium = _sodium

  const seed = sodium.crypto_kdf_keygen()
  return sodium.to_hex(seed)
}

/**
 * Create a random salt for a new env
 *
 * @returns {Promise<string>} - hex encoded env salt
 */
export const newEnvSalt = async () => {
  await _sodium.ready
  const sodium = _sodium

  const seed = sodium.crypto_kdf_keygen()
  return sodium.to_hex(seed)
}

/**
 * Create a random token for a new env
 *
 * @returns {Promise<string>} - hex encoded env token
 */
export const newEnvToken = async () => {
  await _sodium.ready
  const sodium = _sodium

  const token = sodium.crypto_kdf_keygen()
  return sodium.to_hex(token)
}

/**
 * Create a wrapping key for new env secret share
 *
 * @returns {Promise<string>} - hex encoded wrapping key
 */
export const newEnvWrapKey = async () => {
  await _sodium.ready
  const sodium = _sodium

  const key = sodium.crypto_kdf_keygen()
  return sodium.to_hex(key)
}

/**
 * Encrypts an env seed with the given key
 *
 * @param seed - Env seed as a hex string
 * @param key - Encryption key as a hex string
 * @returns {Promise<Uint8Array>}
 */
export const encryptedEnvSeed = async (seed: string, key: string) => {
  await _sodium.ready
  const sodium = _sodium

  const keyBytes = sodium.from_hex(key)
  const encryptedSeed = await cryptoUtils.encryptRaw(seed, keyBytes)
  return sodium.to_hex(encryptedSeed)
}

/**
 * Decrypts an env seed with the given key
 *
 * @param encryptedSeed - Encrytped env seed as a hex string
 * @param key - Decryption key as a hex string
 * @returns {Promise<string>} - hex encoded plaintext app seed
 */
export const decryptedAppSeed = async (encryptedSeed: string, key: string) => {
  await _sodium.ready
  const sodium = _sodium

  const ciphertextBytes = sodium.from_hex(encryptedSeed)
  const keyBytes = sodium.from_hex(key)

  const seedBytes = await cryptoUtils.decryptRaw(ciphertextBytes, keyBytes)
  return sodium.to_string(seedBytes)
}

/**
 * Derives an env keyring from the given seed
 *
 * @param {string} envSeed - Env seed as a hex string
 * @returns {Promise<EnvKeyring>}
 */
export const envKeyring = async (envSeed: string): Promise<EnvKeyring> => {
  await _sodium.ready
  const sodium = _sodium

  const seedBytes = sodium.from_hex(envSeed)
  const envKeypair = sodium.crypto_kx_seed_keypair(seedBytes)

  const { publicKey, privateKey } = envKeypair

  return { publicKey: sodium.to_hex(publicKey), privateKey: sodium.to_hex(privateKey) }
}

export const generateEnvironmentSecret = async (
  environment: EnvironmentType,
  key: EnvironmentKeyType,
  useKeyring: { publicKey: string; privateKey: string }
) => {
  const wrapKey = await newEnvWrapKey()
  const token = await newEnvToken()

  const envSeed = await decryptAsymmetric(
    key.wrappedSeed,
    useKeyring.privateKey,
    useKeyring.publicKey
  )

  const envKeys = await envKeyring(envSeed)

  const keyShares = await splitSecret(envKeys.privateKey)
  const wrappedKeyShare = await cryptoUtils.wrappedKeyShare(keyShares[1], wrapKey)

  const envSalt = await decryptAsymmetric(
    key.wrappedSalt,
    useKeyring.privateKey,
    useKeyring.publicKey
  )

  const pssEnv = `pss_env:v1:${token}:${envKeys.publicKey}:${envSalt}:${keyShares[0]}:${wrapKey}`
  const mutationPayload = {
    envId: environment.id,
    name: 'testSecret',
    identityKey: environment.identityKey,
    token,
    wrappedKeyShare,
  }

  return {
    pssEnv,
    mutationPayload,
  }
}
