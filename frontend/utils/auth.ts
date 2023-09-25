import jwt from 'jsonwebtoken'
import _sodium from 'libsodium-wrappers-sumo'
import { getLocalKeyring } from './localStorage'

export type OrganisationKeyring = {
  symmetricKey: string
  publicKey: string
  privateKey: string
}

type AppKeyring = {
  publicKey: string
  privateKey: string
}

export namespace JwtUtils {
  export const isJwtExpired = (token: string) => {
    // offset by 60 seconds, so we will check if the token is "almost expired".
    const currentTime = Math.round(Date.now() / 1000 + 60)
    const decoded = jwt.decode(token)
    if (decoded === null) return false
    const decodedJwt = decoded as jwt.JwtPayload

    console.log(`Current time + 60 seconds: ${new Date(currentTime * 1000)}`)
    console.log(`Token lifetime: ${new Date(decodedJwt['exp']! * 1000)}`)

    if (decodedJwt['exp']) {
      const adjustedExpiry = decodedJwt['exp']

      if (adjustedExpiry < currentTime) {
        console.log('Token expired')
        return true
      }

      console.log('Token has not expired yet')
      return false
    }

    console.log('Token["exp"] does not exist')
    return true
  }
}

export namespace UrlUtils {
  export const makeUrl = (...endpoints: string[]) => {
    let url = endpoints.reduce((prevUrl, currentPath) => {
      if (prevUrl.length === 0) {
        return prevUrl + currentPath
      }

      return prevUrl.endsWith('/') ? prevUrl + currentPath + '/' : prevUrl + '/' + currentPath + '/'
    }, '')
    return url
  }
}

export namespace cryptoUtils {
  /**
   * Returns 16 bytes from an input string that can be used as a salt for Argon2
   *
   * @param {string} input - The input string to hash
   * @returns {Promise<Uint8Array>} - 16 byte salt
   */
  const saltFromString = async (input: string) => {
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
  export const encryptedAppSeed = async (seed: string, key: string) => {
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
  export const decryptedAppSeed = async (encryptedSeed: string, key: string) => {
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

  export const wrappedKeyShare = async (keyShare: string, wrapKey: string) => {
    await _sodium.ready
    const sodium = _sodium
    const keyBytes = sodium.from_hex(wrapKey)
    const wrappedKey = await encryptRaw(keyShare, keyBytes)
    return sodium.to_hex(wrappedKey)
  }

  export const getInviteLink = (inviteId: string) => {
    const sodium = _sodium

    const hostname = `${window.location.protocol}/${window.location.host}`
    const encodedInvite = sodium.to_base64(inviteId, sodium.base64_variants.ORIGINAL)
    return `${hostname}/invite/${encodedInvite}`
  }

  export const decodeInvite = async (hash: string) => {
    await _sodium.ready
    const sodium = _sodium

    return sodium.to_string(sodium.from_base64(hash, sodium.base64_variants.ORIGINAL))
  }

  export const getKeyring = async (email: string, organisationId: string, password: string) => {
    return new Promise<OrganisationKeyring>(async (resolve, reject) => {
      const encryptedKeyring = getLocalKeyring(email, organisationId)
      if (!encryptedKeyring) reject('Error fetching local encrypted keys from browser')

      try {
        const deviceKey = await deviceVaultKey(password, email)
        const decryptedKeyring = await decryptAccountKeyring(encryptedKeyring!, deviceKey)
        resolve(decryptedKeyring)
      } catch (e) {
        reject(`Error unlocking user keyring: ${e}`)
      }
    })
  }
}
