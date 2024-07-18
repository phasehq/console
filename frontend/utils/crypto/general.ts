import _sodium, { KeyPair, StringOutputFormat } from 'libsodium-wrappers-sumo'
import { VERSION } from './constants'

/**
 * Compares two arrays for equality.
 *
 * @param {any[]} arr1 - The first array.
 * @param {any[]} arr2 - The second array.
 * @returns {boolean} - True if the arrays are equal, false otherwise.
 */
export const arraysEqual = (arr1: any[], arr2: any[]) => {
  if (arr1.length !== arr2.length) {
    return false
  }
  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) {
      return false
    }
  }
  return true
}

/**
 * Returns 16 bytes from an input string that can be used as a salt for Argon2
 *
 * @param {string} input - The input string to hash
 * @returns {Promise<Uint8Array>} - 16 byte salt
 */
export const saltFromString = async (input: string) => {
  await _sodium.ready
  const sodium = _sodium

  const inputBytes = sodium.from_string(input)
  const hash = sodium.crypto_generichash(16, inputBytes)
  return hash
}

/**
 * XChaCha20-Poly1305 encrypt
 *
 * @param {String} plaintext
 * @param {Uint8Array} key
 * @returns {Promise<Uint8Array>} - Ciphertext with appended nonce
 */
export const encryptRaw = async (plaintext: string, key: Uint8Array): Promise<Uint8Array> => {
  await _sodium.ready
  const sodium = _sodium

  let nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  let ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    null,
    null,
    nonce,
    key
  )
  return new Uint8Array([...ciphertext, ...nonce])
}

/**
 * XChaCha20-Poly1305 decrypt
 *
 * @param {Uint8Array} encryptedMessage - Ciphertext + Nonce
 * @param {Uint8Array} key - Decryption key
 * @returns {Promise<Uint8Array>}
 */
export const decryptRaw = async (
  encryptedMessage: Uint8Array,
  key: Uint8Array
): Promise<Uint8Array> => {
  await _sodium.ready
  const sodium = _sodium

  const messageLen = encryptedMessage.length - 24
  const nonce = encryptedMessage.slice(messageLen)
  const ciphertext = encryptedMessage.slice(0, messageLen)

  const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    null,
    nonce,
    key
  )

  return plaintext
}

/**
 * Encrypts a single string with the given key. Returns the ciphertext as a base64 string
 *
 * @param {string} plaintext - Plaintext string to encrypt
 * @param {Uint8Array} key - Symmetric encryption key
 * @returns {string}
 */
export const encryptString = async (plaintext: string, key: Uint8Array) => {
  await _sodium.ready
  const sodium = _sodium

  return sodium.to_base64(await encryptRaw(plaintext, key), sodium.base64_variants.ORIGINAL)
}

/**
 * Decrypts a single base64 ciphertext string with the given key. Returns the plaintext as a string
 *
 * @param cipherText - base64 string ciphertext with appended nonce
 * @param key - Symmetric encryption key
 * @returns {string}
 */
export const decryptString = async (cipherText: string, key: Uint8Array) => {
  await _sodium.ready
  const sodium = _sodium

  return sodium.to_string(
    await decryptRaw(sodium.from_base64(cipherText, sodium.base64_variants.ORIGINAL), key)
  )
}

/**
 *
 */
export const getWrappedKeyShare = async (keyShare: string, wrapKey: string) => {
  await _sodium.ready
  const sodium = _sodium
  const keyBytes = sodium.from_hex(wrapKey)
  const wrappedKey = await encryptRaw(keyShare, keyBytes)
  return sodium.to_hex(wrappedKey)
}

export const decodeb64string = async (b64string: string) => {
  await _sodium.ready
  const sodium = _sodium

  return sodium.to_string(sodium.from_base64(b64string, sodium.base64_variants.ORIGINAL))
}

/**
 * Returns an random key exchange keypair
 *
 * @returns {KeyPair}
 */
export const randomKeyPair = async () => {
  await _sodium.ready
  const sodium = _sodium
  const keypair = await sodium.crypto_kx_keypair()

  return keypair
}

/**
 * Returns an random key exchange keypair encoded in the specified formatx
 *
 * @returns {KeyPair}
 */
export const randomFormattedKeyPair = async (format: StringOutputFormat) => {
  await _sodium.ready
  const sodium = _sodium
  const keypair = await sodium.crypto_kx_keypair(format)

  return keypair
}

/**
 * Carries out diffie-hellman key exchange for client and returns a pair of symmetric encryption keys
 *
 * @param {KeyPair} ephemeralKeyPair
 * @param {Uint8Array} recipientPubKey
 * @returns
 */
export const clientSessionKeys = async (ephemeralKeyPair: KeyPair, recipientPubKey: Uint8Array) => {
  await _sodium.ready
  const sodium = _sodium

  const keys = await sodium.crypto_kx_client_session_keys(
    ephemeralKeyPair.publicKey,
    ephemeralKeyPair.privateKey,
    recipientPubKey
  )
  return keys
}

/**
 * Carries out diffie-hellman key exchange for server and returns a pair of symmetric encryption keys
 *
 * @param {KeyPair} ephemeralKeyPair
 * @param {Uint8Array} recipientPubKey
 * @returns
 */
export const serverSessionKeys = async (
  appKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array },
  dataPubKey: Uint8Array
) => {
  await _sodium.ready
  const sodium = _sodium
  const keys = await sodium.crypto_kx_server_session_keys(
    appKeyPair.publicKey,
    appKeyPair.privateKey,
    dataPubKey
  )
  return keys
}

export const createSealedBox = async (plaintext: string, publicKey: string) => {
  await _sodium.ready
  const sodium = _sodium

  const sealedBox = await sodium.crypto_box_seal(plaintext, sodium.from_hex(publicKey))
  return `ph:${VERSION}:${sodium.to_base64(sealedBox)}`
}

export const openSealedBox = async (ciphertext: string, publicKey: string, privateKey: string) => {
  await _sodium.ready
  const sodium = _sodium

  const ciphertextSegments = ciphertext.split(':')

  const plaintext = sodium.crypto_box_seal_open(
    sodium.from_base64(ciphertextSegments[2]),
    sodium.from_hex(publicKey),
    sodium.from_hex(privateKey)
  )
  return sodium.to_string(plaintext)
}

export const encryptAsymmetric = async (plaintext: string, publicKey: string): Promise<string> => {
  await _sodium.ready
  const sodium = _sodium

  return new Promise<string>(async (resolve, reject) => {
    try {
      const oneTimeKeyPair = await randomKeyPair()

      const symmetricKeys = await clientSessionKeys(oneTimeKeyPair, sodium.from_hex(publicKey))

      const ciphertext = await encryptString(plaintext, symmetricKeys.sharedTx)

      // Use sodium.memzero to wipe the keys from memory
      sodium.memzero(oneTimeKeyPair.privateKey)
      sodium.memzero(symmetricKeys.sharedTx)
      sodium.memzero(symmetricKeys.sharedRx)

      resolve(`ph:v${VERSION}:${sodium.to_hex(oneTimeKeyPair.publicKey)}:${ciphertext}`)
    } catch (error) {
      reject(`Something went wrong: ${error}`)
    }
  })
}

export const decryptAsymmetric = async (
  ciphertextString: string,
  privateKey: string,
  publicKey: string
): Promise<string> => {
  await _sodium.ready
  const sodium = _sodium

  return new Promise<string>(async (resolve, reject) => {
    const ciphertextSegments = ciphertextString.split(':')

    if (ciphertextSegments.length !== 4) reject('Invalid ciphertext')

    const ciphertext = {
      prefix: ciphertextSegments[0],
      version: ciphertextSegments[1],
      pubKey: ciphertextSegments[2],
      data: ciphertextSegments[3],
    }

    try {
      const sessionKeys = await serverSessionKeys(
        {
          publicKey: sodium.from_hex(publicKey) as Uint8Array,
          privateKey: sodium.from_hex(privateKey) as Uint8Array,
        },
        sodium.from_hex(ciphertext.pubKey)
      )

      const plaintext = await decryptString(ciphertext.data, sessionKeys.sharedRx)

      // Use sodium.memzero to wipe the keys from memory
      sodium.memzero(sessionKeys.sharedRx)
      sodium.memzero(sessionKeys.sharedTx)

      resolve(plaintext)
    } catch (error) {
      reject(`Something went wrong: ${error}`)
    }
  })
}

export const digest = async (input: string, salt: string) => {
  await _sodium.ready
  const sodium = _sodium

  const hash = await sodium.crypto_generichash(32, input, salt)
  return sodium.to_hex(hash)
}
