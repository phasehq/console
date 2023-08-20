import _sodium from 'libsodium-wrappers-sumo'
import { cryptoUtils } from '@/utils/auth'
import { splitSecret } from './keyshares'
import {
  ApiEnvironmentEnvTypeChoices,
  EnvironmentKeyType,
  EnvironmentType,
  OrganisationMemberType,
} from '@/apollo/graphql'
import { decryptAsymmetric, encryptAsymmetric, getUserKxPublicKey } from './crypto'

export type EnvKeyring = {
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

export const generateEnvironmentToken = async (
  environment: EnvironmentType,
  key: EnvironmentKeyType,
  userKeyring: { publicKey: string; privateKey: string }
) => {
  const wrapKey = await newEnvWrapKey()
  const token = await newEnvToken()

  const envSeed = await decryptAsymmetric(
    key.wrappedSeed,
    userKeyring.privateKey,
    userKeyring.publicKey
  )

  const envKeys = await envKeyring(envSeed)

  const keyShares = await splitSecret(envKeys.privateKey)
  const wrappedKeyShare = await cryptoUtils.wrappedKeyShare(keyShares[1], wrapKey)

  const envSalt = await decryptAsymmetric(
    key.wrappedSalt,
    userKeyring.privateKey,
    userKeyring.publicKey
  )

  const pssEnv = `pss_env:v1:${token}:${envKeys.publicKey}:${envSalt}:${keyShares[0]}:${wrapKey}`
  const mutationPayload = {
    envId: environment.id,
    name: 'testEnvToken',
    identityKey: environment.identityKey,
    token,
    wrappedKeyShare,
  }

  return {
    pssEnv,
    mutationPayload,
  }
}

export const generateUserToken = async (
  orgId: string,
  userKeyring: { publicKey: string; privateKey: string }
) => {
  const wrapKey = await newEnvWrapKey()
  const token = await newEnvToken()

  const keyShares = await splitSecret(userKeyring.privateKey)
  const wrappedKeyShare = await cryptoUtils.wrappedKeyShare(keyShares[1], wrapKey)

  const pssUser = `pss_user:v1:${token}:${userKeyring.publicKey}:${keyShares[0]}:${wrapKey}`
  const mutationPayload = {
    orgId,
    name: 'testUserToken',
    identityKey: userKeyring.publicKey,
    token,
    wrappedKeyShare,
  }

  return {
    pssUser,
    mutationPayload,
  }
}

const wrapEnvSecretsForUser = async (
  envSecrets: { seed: string; salt: string },
  user: OrganisationMemberType
) => {
  const userPubKey = await getUserKxPublicKey(user.identityKey!)
  const wrappedSeed = await encryptAsymmetric(envSecrets.seed, userPubKey)
  const wrappedSalt = await encryptAsymmetric(envSecrets.salt, userPubKey)

  return {
    user,
    wrappedSeed,
    wrappedSalt,
  }
}

export const createNewEnvPayload = async (
  appId: string,
  name: string,
  envType: ApiEnvironmentEnvTypeChoices,
  user: OrganisationMemberType
) => {
  const seed = await newEnvSeed()
  const keys = await envKeyring(seed)

  const salt = await newEnvSalt()

  const ownerWrappedEnv = await wrapEnvSecretsForUser({ seed, salt }, user)

  return {
    appId,
    name,
    envType,
    wrappedSeed: ownerWrappedEnv.wrappedSeed,
    wrappedSalt: ownerWrappedEnv.wrappedSalt,
    identityKey: keys.publicKey,
  }
}
