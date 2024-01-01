import _sodium, { KeyPair } from 'libsodium-wrappers-sumo'
import { cryptoUtils } from './auth'

export const VERSION = 1

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

      const ciphertext = await cryptoUtils.encryptString(plaintext, symmetricKeys.sharedTx)

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

      const plaintext = await cryptoUtils.decryptString(ciphertext.data, sessionKeys.sharedRx)

      // Use sodium.memzero to wipe the keys from memory
      sodium.memzero(sessionKeys.sharedRx)
      sodium.memzero(sessionKeys.sharedTx)

      resolve(plaintext)
    } catch (error) {
      reject(`Something went wrong: ${error}`)
    }
  })
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

export const digest = async (input: string, salt: string) => {
  await _sodium.ready
  const sodium = _sodium

  const hash = await sodium.crypto_generichash(32, input, salt)
  return sodium.to_hex(hash)
}
