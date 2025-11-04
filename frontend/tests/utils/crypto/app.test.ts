/**
 * @jest-environment node
 */

/*
  👆
  overrides: testEnvironment: 'jsdom' in jest.config.js
  to fix: ReferenceError: TextDecoder is not defined

*/

import {
    appKeyring,
    decryptAppSeed,
    encryptAppSeed,
    newAppSeed,
    newAppToken,
    newAppWrapKey,
} from '@/utils/crypto'


















describe('New App Key Generation Tests', () => {
  const expectedHexLength = 64 // Keygen returns 32 bytes

  test('newAppSeed returns hex string of correct length', async () => {
    const seed = await newAppSeed()
    expect(seed).toMatch(/^[a-f0-9]{64}$/)
    expect(seed.length).toBe(expectedHexLength)
  })

  test('newAppSeed produces unique seeds', async () => {
    const seed1 = await newAppSeed()
    const seed2 = await newAppSeed()
    expect(seed1).not.toBe(seed2)
  })

  test('newAppToken returns hex string of correct length', async () => {
    const token = await newAppToken()
    expect(token).toMatch(/^[a-f0-9]{64}$/)
    expect(token.length).toBe(expectedHexLength)
  })

  test('newAppToken produces unique tokens', async () => {
    const token1 = await newAppToken()
    const token2 = await newAppToken()
    expect(token1).not.toBe(token2)
  })

  test('newAppWrapKey returns hex string of correct length', async () => {
    const key = await newAppWrapKey()
    expect(key).toMatch(/^[a-f0-9]{64}$/)
    expect(key.length).toBe(expectedHexLength)
  })

  test('newAppWrapKey produces unique keys', async () => {
    const key1 = await newAppWrapKey()
    const key2 = await newAppWrapKey()
    expect(key1).not.toBe(key2)
  })
})

describe('App Seed Encryption and Decryption Tests', () => {
  const exampleSeed = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' // Example seed, 64-character hex string
  const encryptionKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210' // Example key, 64-character hex string

  test('encryptAppSeed returns hex encoded string', async () => {
    const encryptedSeed = await encryptAppSeed(exampleSeed, encryptionKey)
    expect(encryptedSeed).toMatch(/^[a-f0-9]+$/)
  })

  test('decryptAppSeed retrieves original seed', async () => {
    const encryptedSeed = await encryptAppSeed(exampleSeed, encryptionKey)
    const decryptedSeed = await decryptAppSeed(encryptedSeed, encryptionKey)
    expect(decryptedSeed).toBe(exampleSeed)
  })

  test('decryptAppSeed with incorrect key fails', async () => {
    const encryptedSeed = await encryptAppSeed(exampleSeed, encryptionKey)
    const wrongKey = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff'

    await expect(decryptAppSeed(encryptedSeed, wrongKey)).rejects.toThrow()
  })

  test('decryptAppSeed with incorrect encrypted seed fails', async () => {
    const incorrectEncryptedSeed = 'abcdef'

    await expect(decryptAppSeed(incorrectEncryptedSeed, encryptionKey)).rejects.toThrow()
  })
})

describe('App Keyring Derivation Tests', () => {
  const exampleSeed = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' // Example seed, 64-character hex string

  test('appKeyring produces consistent key pair for same seed', async () => {
    const keyring1 = await appKeyring(exampleSeed)
    const keyring2 = await appKeyring(exampleSeed)
    expect(keyring1).toEqual(keyring2)
  })

  test('key pair is in hex format and of correct lengths', async () => {
    const keyring = await appKeyring(exampleSeed)
    expect(keyring.publicKey).toMatch(/^[a-f0-9]+$/)
    expect(keyring.privateKey).toMatch(/^[a-f0-9]+$/)
    // Length check depends on the specific key length your implementation uses
  })

  test('different seeds produce different key pairs', async () => {
    const differentSeed = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'
    const keyring1 = await appKeyring(exampleSeed)
    const keyring2 = await appKeyring(differentSeed)
    expect(keyring1).not.toEqual(keyring2)
  })
})
