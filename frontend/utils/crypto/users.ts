import _sodium from 'libsodium-wrappers-sumo'
import { saltFromString, encryptRaw, decryptRaw } from './general'
import { OrganisationKeyring } from './types'
import { OrganisationType } from '@/apollo/graphql'

/**
 * Computes the account recovery key from the mnemonic phrase and orgId.
 * Note: This can take between 15-20 seconds to resolve
 *
 * @param {string} mnemonic - Mnemonic phrase separated by spaces
 * @param {string} orgId - The organisation uuid4
 * @returns {Promise<Uint8Array>} - 64 byte account seed
 */
export const organisationSeed = async (mnemonic: string, orgId: string): Promise<Uint8Array> => {
  await _sodium.ready
  const sodium = _sodium

  const OPSLIMIT = sodium.crypto_pwhash_OPSLIMIT_SENSITIVE
  const MEMLIMIT = sodium.crypto_pwhash_MEMLIMIT_SENSITIVE
  const ALG = sodium.crypto_pwhash_ALG_ARGON2ID13

  const seedInput = mnemonic.split(' ').join('-')
  const salt = await saltFromString(orgId)

  const seed = sodium.crypto_pwhash(32, seedInput, salt as Uint8Array, OPSLIMIT, MEMLIMIT, ALG)
  return seed
}

/**
 * Returns the organisation keyring, derived from the hardened seed
 *
 * @param {Uint8Array} seed - Account hardened seed
 * @returns {Promise<OrganisationKeyring>} Account keyring
 */
export const organisationKeyring = async (seed: Uint8Array): Promise<OrganisationKeyring> => {
  await _sodium.ready
  const sodium = _sodium

  const SYMMETRIC_KEY_ID = 0
  const SYMMETRIC_KEY_CONTEXT = '_secret_'

  const SIGNING_KEY_ID = 1
  const SIGNING_KEY_CONTEXT = '__sign__'

  const symmetricKey = sodium.crypto_kdf_derive_from_key(
    32,
    SYMMETRIC_KEY_ID,
    SYMMETRIC_KEY_CONTEXT,
    seed
  )

  const signingKeySeed = sodium.crypto_kdf_derive_from_key(
    32,
    SIGNING_KEY_ID,
    SIGNING_KEY_CONTEXT,
    seed
  )

  const signingKey = sodium.crypto_sign_seed_keypair(signingKeySeed)

  return {
    symmetricKey: sodium.to_hex(symmetricKey),
    privateKey: sodium.to_hex(signingKey.privateKey),
    publicKey: sodium.to_hex(signingKey.publicKey),
  } as OrganisationKeyring
}

/**
 * Derives a local device encryption key from the password + email
 *
 * @param {string} password - Local account password
 * @param {string} email - Account email
 * @returns {Promise<string>} - Device encryption key as a hex string
 */
export const deviceVaultKey = async (password: string, email: string): Promise<string> => {
  await _sodium.ready
  const sodium = _sodium

  const OPSLIMIT = sodium.crypto_pwhash_OPSLIMIT_MODERATE
  const MEMLIMIT = sodium.crypto_pwhash_MEMLIMIT_MODERATE
  const ALG = sodium.crypto_pwhash_ALG_ARGON2ID13

  const salt = await saltFromString(email)

  const key = sodium.crypto_pwhash(32, password, salt, OPSLIMIT, MEMLIMIT, ALG)
  return sodium.to_hex(key)
}

/**
 * Encrypts the account keyring for local storage
 *
 * @param {OrganisationKeyring} keyring - Account keyring
 * @param {string} key - hex encoded local encryption key
 * @returns {string} - hex encoded encrypted keyring
 */
export const encryptAccountKeyring = async (keyring: OrganisationKeyring, key: string) => {
  await _sodium.ready
  const sodium = _sodium

  const keyBytes = sodium.from_hex(key)

  const encryptedKeyring = await encryptRaw(JSON.stringify(keyring), keyBytes)
  return sodium.to_hex(encryptedKeyring)
}

export const getUserKxPublicKey = async (signingPublicKey: string) => {
  await _sodium.ready
  const sodium = _sodium

  return sodium.to_hex(
    sodium.crypto_sign_ed25519_pk_to_curve25519(sodium.from_hex(signingPublicKey))
  )
}

export const getUserKxPrivateKey = async (signingPrivateKey: string) => {
  await _sodium.ready
  const sodium = _sodium

  return sodium.to_hex(
    sodium.crypto_sign_ed25519_sk_to_curve25519(sodium.from_hex(signingPrivateKey))
  )
}

/**
 * Decrypts an Organisation keyring
 *
 * @param encryptedKeyring - Hex encoded encrypted keyring
 * @param key - Hex encoded decryption key
 * @returns {OrganisationKeyring}
 */
export const decryptAccountKeyring = async (encryptedKeyring: string, key: string) => {
  await _sodium.ready
  const sodium = _sodium

  const ciphertextBytes = sodium.from_hex(encryptedKeyring)
  const keyBytes = sodium.from_hex(key)

  const plaintextBytes = await decryptRaw(ciphertextBytes, keyBytes)
  const plaintext = sodium.to_string(plaintextBytes)
  return JSON.parse(plaintext) as OrganisationKeyring
}

/**
 * Encrypts the account mnemonic for local storage
 *
 * @param {string} mnemonic - Account recovery phrase
 * @param {string} key - hex encoded local encryption key
 * @returns {string} - hex encoded encrypted keyring
 */
export const encryptAccountRecovery = async (mnemonic: string, key: string) => {
  await _sodium.ready
  const sodium = _sodium

  const keyBytes = sodium.from_hex(key)

  const encryptedRecovery = await encryptRaw(mnemonic, keyBytes)
  return sodium.to_hex(encryptedRecovery)
}

/**
 * Decrypts an Account recovery phrase
 *
 * @param encryptedRecovery - Hex encoded encrypted recovery phrase
 * @param key - Hex encoded decryption key
 * @returns {string}
 */
export const decryptAccountRecovery = async (encryptedRecovery: string, key: string) => {
  await _sodium.ready
  const sodium = _sodium

  const ciphertextBytes = sodium.from_hex(encryptedRecovery)
  const keyBytes = sodium.from_hex(key)

  const plaintextBytes = await decryptRaw(ciphertextBytes, keyBytes)
  const plaintext = sodium.to_string(plaintextBytes)
  return plaintext
}

export const getInviteLink = (inviteId: string) => {
  const sodium = _sodium

  const hostname = `${window.location.protocol}//${window.location.host}`
  const encodedInvite = sodium.to_base64(inviteId, sodium.base64_variants.ORIGINAL)
  return `${hostname}/invite/${encodedInvite}`
}

export const getKeyring = async (
  email: string,
  organisation: OrganisationType,
  password: string
) => {
  return new Promise<OrganisationKeyring>(async (resolve, reject) => {
    const encryptedKeyring = organisation.keyring!

    try {
      const deviceKey = await deviceVaultKey(password, email)
      const decryptedKeyring = await decryptAccountKeyring(encryptedKeyring!, deviceKey)
      resolve(decryptedKeyring)
    } catch (e) {
      reject(`Error unlocking user keyring: ${e}`)
    }
  })
}
