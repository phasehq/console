import _sodium from 'libsodium-wrappers-sumo'

import {
  ApiEnvironmentEnvTypeChoices,
  EnvironmentKeyType,
  EnvironmentType,
  OrganisationMemberType,
  SecretType,
  ServiceAccountType,
} from '@/apollo/graphql'

import { EnvKeypair, OrganisationKeyring } from './types'
import {
  encryptRaw,
  decryptRaw,
  randomKeyPair,
  decryptAsymmetric,
  encryptAsymmetric,
  getWrappedKeyShare,
} from './general'
import { splitSecret } from './keyshares'
import { getUserKxPublicKey, getUserKxPrivateKey } from './users'

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
 * @param {string} seed - Env seed as a hex string
 * @param {string} key - Encryption key as a hex string
 * @returns {Promise<string>} - hex encoded encrypted seed
 */
export const encryptedEnvSeed = async (seed: string, key: string) => {
  await _sodium.ready
  const sodium = _sodium

  const keyBytes = sodium.from_hex(key)
  const encryptedSeed = await encryptRaw(seed, keyBytes)
  return sodium.to_hex(encryptedSeed)
}

/**
 * Decrypts an env seed with the given key
 *
 * @param {string} encryptedSeed - Encrypted env seed as a hex string
 * @param {string} key - Decryption key as a hex string
 * @returns {Promise<string>} - hex encoded plaintext app seed
 */
export const decryptedEnvSeed = async (encryptedSeed: string, key: string) => {
  await _sodium.ready
  const sodium = _sodium

  const ciphertextBytes = sodium.from_hex(encryptedSeed)
  const keyBytes = sodium.from_hex(key)

  const seedBytes = await decryptRaw(ciphertextBytes, keyBytes)
  return sodium.to_string(seedBytes)
}

/**
 * Derives an env keyring from the given seed
 *
 * @param {string} envSeed - Env seed as a hex string
 * @returns {Promise<EnvKeypair>}
 */
export const envKeyring = async (envSeed: string): Promise<EnvKeypair> => {
  await _sodium.ready
  const sodium = _sodium

  const seedBytes = sodium.from_hex(envSeed)
  const envKeypair = sodium.crypto_kx_seed_keypair(seedBytes)

  const { publicKey, privateKey } = envKeypair

  return { publicKey: sodium.to_hex(publicKey), privateKey: sodium.to_hex(privateKey) }
}

export const newServiceTokenKeys = async () => {
  await _sodium.ready
  const sodium = _sodium

  const { publicKey, privateKey } = await randomKeyPair()

  return {
    publicKey: sodium.to_hex(publicKey),
    privateKey: sodium.to_hex(privateKey),
  }
}

/**
 * Generates an environment token.
 *
 * @param {EnvironmentType} environment - The environment for which the token is generated.
 * @param {EnvironmentKeyType} key - The key associated with the environment.
 * @param {{ publicKey: string; privateKey: string }} userKeyring - The user's keyring.
 * @returns {Promise<{ pssEnv: string; mutationPayload: object }>} - An object containing the environment token and mutation payload.
 */
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
  const wrappedKeyShare = await getWrappedKeyShare(keyShares[1], wrapKey)

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

/**
 * Generates a user token.
 *
 * @param {string} orgId - The organization ID.
 * @param {{ publicKey: string; privateKey: string }} userKeyring - The user's keyring.
 * @returns {Promise<{ pssUser: string; mutationPayload: object }>} - An object containing the user token and mutation payload.
 */
export const generateUserToken = async (
  orgId: string,
  userKeyring: { publicKey: string; privateKey: string },
  name: string,
  expiry: number | null
) => {
  const wrapKey = await newEnvWrapKey()
  const token = await newEnvToken()

  const keyShares = await splitSecret(userKeyring.privateKey)
  const wrappedKeyShare = await getWrappedKeyShare(keyShares[1], wrapKey)

  const pssUser = `pss_user:v1:${token}:${userKeyring.publicKey}:${keyShares[0]}:${wrapKey}`
  const mutationPayload = {
    orgId,
    name,
    identityKey: userKeyring.publicKey,
    token,
    wrappedKeyShare,
    expiry,
  }

  return {
    pssUser,
    mutationPayload,
  }
}

/**
 * Wraps environment secrets for a user.
 *
 * @param {{ seed: string; salt: string }} envSecrets - The environment secrets to be wrapped.
 * @param {OrganisationMemberType | ServiceAccountType} account - The target account for whom the secrets are wrapped.
 * @returns {Promise<{ user: OrganisationMemberType; wrappedSeed: string; wrappedSalt: string }>} - An object containing the wrapped environment secrets and user information.
 */
export const wrapEnvSecretsForAccount = async (
  envSecrets: { seed: string; salt: string },
  account: OrganisationMemberType | ServiceAccountType
) => {
  const userPubKey = await getUserKxPublicKey(account.identityKey!)
  const wrappedSeed = await encryptAsymmetric(envSecrets.seed, userPubKey)
  const wrappedSalt = await encryptAsymmetric(envSecrets.salt, userPubKey)

  return {
    user: account,
    wrappedSeed,
    wrappedSalt,
  }
}

/**
 * Wraps environment secrets for the server.
 *
 * @param {{ seed: string; salt: string }} envSecrets - The environment secrets to be wrapped.
 * @param {string} serverPubKey - The server public key.
 * @returns {Promise<{ user: OrganisationMemberType; wrappedSeed: string; wrappedSalt: string }>} - An object containing the wrapped environment secrets and user information.
 */
export const wrapEnvSecretsForServer = async (
  envSecrets: { seed: string; salt: string },
  serverPubKey: string
) => {
  const wrappedSeed = await encryptAsymmetric(envSecrets.seed, serverPubKey)
  const wrappedSalt = await encryptAsymmetric(envSecrets.salt, serverPubKey)

  return {
    wrappedSeed,
    wrappedSalt,
  }
}

/**
 * Wraps environment secrets for a service token.
 *
 * @param {{ seed: string; salt: string }} envSecrets - The environment secrets to be wrapped.
 * @param {string} publicKey - The public key of the service token.
 * @returns {Promise<{ wrappedSeed: string; wrappedSalt: string }>} - An object containing the wrapped environment secrets.
 */
export const wrapEnvSecretsForServiceToken = async (
  envSecrets: { seed: string; salt: string },
  publicKey: string
) => {
  //const servicePubKey = await getUserKxPublicKey(publicKey)
  const wrappedSeed = await encryptAsymmetric(envSecrets.seed, publicKey)
  const wrappedSalt = await encryptAsymmetric(envSecrets.salt, publicKey)

  return {
    wrappedSeed,
    wrappedSalt,
  }
}

/**
 * Unwraps environment secrets for a user.
 *
 * @param {string} wrappedSeed - The wrapped environment seed.
 * @param {string} wrappedSalt - The wrapped environment salt.
 * @param {OrganisationKeyring} keyring - The keyring of the user.
 * @returns {Promise<{ publicKey: string; privateKey: string; salt: string }>} - An object containing the unwrapped environment secrets.
 */
export const unwrapEnvSecretsForUser = async (
  wrappedSeed: string,
  wrappedSalt: string,
  keyring: OrganisationKeyring
) => {
  const userKxKeys = {
    publicKey: await getUserKxPublicKey(keyring!.publicKey),
    privateKey: await getUserKxPrivateKey(keyring!.privateKey),
  }
  const seed = await decryptAsymmetric(wrappedSeed, userKxKeys.privateKey, userKxKeys.publicKey)

  const salt = await decryptAsymmetric(wrappedSalt, userKxKeys.privateKey, userKxKeys.publicKey)

  const { publicKey, privateKey } = await envKeyring(seed)

  return {
    seed,
    publicKey,
    privateKey,
    salt,
  }
}

/**
 * Decrypts environment secret key and value pairs.
 *
 * @param {SecretType[]} encryptedSecrets - An array of encrypted secrets.
 * @param {{ publicKey: string; privateKey: string }} envKeys - The environment keys for decryption.
 * @returns {Promise<SecretType[]>} - An array of decrypted secrets.
 */
export const decryptEnvSecretKVs = async (
  encryptedSecrets: SecretType[],
  envKeys: { publicKey: string; privateKey: string }
) => {
  const decryptedSecrets = await Promise.all(
    encryptedSecrets.map(async (secret: SecretType) => {
      const decryptedSecret = structuredClone(secret)
      decryptedSecret.key = await decryptAsymmetric(
        secret.key,
        envKeys?.privateKey,
        envKeys?.publicKey
      )

      decryptedSecret.value = await decryptAsymmetric(
        secret.value,
        envKeys?.privateKey,
        envKeys?.publicKey
      )

      decryptedSecret.comment = secret.comment ? await decryptAsymmetric(
        secret.comment,
        envKeys?.privateKey,
        envKeys?.publicKey
      ) : secret.comment

      return decryptedSecret
    })
  )
  return decryptedSecrets
}

/**
 * Decrypts environment secrets.
 *
 * @param {SecretType[]} encryptedSecrets - An array of encrypted secrets.
 * @param {{ publicKey: string; privateKey: string }} envKeys - The environment keys for decryption.
 * @returns {Promise<SecretType[]>} - An array of decrypted secrets.
 */
export const decryptEnvSecrets = async (
  encryptedSecrets: SecretType[],
  envKeys: { publicKey: string; privateKey: string }
) => {
  const decryptedSecrets = await Promise.all(
    encryptedSecrets.map(async (secret: SecretType) => {
      const decryptedSecret = structuredClone(secret)
      decryptedSecret.key = await decryptAsymmetric(
        secret.key,
        envKeys?.privateKey,
        envKeys?.publicKey
      )
      decryptedSecret.value = await decryptAsymmetric(
        secret.value,
        envKeys.privateKey,
        envKeys.publicKey
      )
      return decryptedSecret
    })
  )
  return decryptedSecrets
}

/**
 * Creates a new environment payload.
 *
 * @param {string} appId - The ID of the application.
 * @param {string} name - The name of the environment.
 * @param {ApiEnvironmentEnvTypeChoices} envType - The type of environment.
 * @param {OrganisationMemberType} owner - The user for whom the environment is created.
 * @param {string?} serverKey - Server public key, if keys need to wrapped for sse
 * @returns {Promise<object>} - An object containing the environment payload.
 */
export const createNewEnv = async (
  appId: string,
  name: string,
  envType: ApiEnvironmentEnvTypeChoices,
  globalAccessUsers: OrganisationMemberType[],
  serverKey?: string
) => {
  const seed = await newEnvSeed()
  const keys = await envKeyring(seed)

  const salt = await newEnvSalt()

  const owner = globalAccessUsers.find(
    (user: OrganisationMemberType) => user.role!.name?.toLowerCase() === "owner"
  )

  const ownerWrappedEnv = await wrapEnvSecretsForAccount({ seed, salt }, owner!)
  const globalAccessUsersWrappedEnv = await Promise.all(
    globalAccessUsers
      .filter((user) => user.role!.name?.toLowerCase() !== "owner")
      .map(async (admin) => {
        const adminWrappedEnvSecret = await wrapEnvSecretsForAccount({ seed, salt }, admin)
        return adminWrappedEnvSecret
      })
  )

  const payloads = {
    createEnvPayload: {
      appId,
      name,
      envType,
      wrappedSeed: ownerWrappedEnv.wrappedSeed,
      wrappedSalt: ownerWrappedEnv.wrappedSalt,
      identityKey: keys.publicKey,
    },
    adminKeysPayload: globalAccessUsersWrappedEnv.map((wrappedSecrets) => {
      const { wrappedSeed, wrappedSalt, user } = wrappedSecrets
      return {
        identityKey: keys.publicKey,
        wrappedSeed,
        wrappedSalt,
        userId: user.id,
        envId: '',
      }
    }),
    serverKeysPayload: {} as { wrappedSeed: string; wrappedSalt: string },
  }

  if (serverKey) {
    const { wrappedSeed: serverWrappedSeed, wrappedSalt: serverWrappedSalt } =
      await wrapEnvSecretsForServer({ seed, salt }, serverKey)

    payloads.serverKeysPayload = {
      wrappedSeed: serverWrappedSeed,
      wrappedSalt: serverWrappedSalt,
    }
  }

  return payloads
}
