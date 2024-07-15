/**
 * @jest-environment node
 */

/*
  👆
  overrides: testEnvironment: 'jsdom' in jest.config.js
  to fix: ReferenceError: TextDecoder is not defined
*/

import {
  clientSessionKeys,
  decryptAsymmetric,
  decryptRaw,
  decryptString,
  digest,
  encryptAsymmetric,
  encryptRaw,
  encryptString,
  randomKeyPair,
  saltFromString,
  serverSessionKeys,
  VERSION,
} from '@/utils/crypto'

describe('Crypto Utils Tests', () => {
  test('randomKeyPair generates keys of correct length', async () => {
    const keyPair = await randomKeyPair()
    expect(keyPair.publicKey.length).toBe(32)
    expect(keyPair.privateKey.length).toBe(32)
  })

  test('clientSessionKeys generates keys of correct length', async () => {
    const clientKeyPair = await randomKeyPair()
    const serverKeyPair = await randomKeyPair()
    const clientKeys = await clientSessionKeys(clientKeyPair, serverKeyPair.publicKey)
    expect(clientKeys.sharedRx.length).toBe(32)
    expect(clientKeys.sharedTx.length).toBe(32)
  })

  test('serverSessionKeys generates keys of correct length', async () => {
    const serverKeyPair = await randomKeyPair()
    const clientKeyPair = await randomKeyPair()
    const serverKeys = await serverSessionKeys(serverKeyPair, clientKeyPair.publicKey)
    expect(serverKeys.sharedRx.length).toBe(32)
    expect(serverKeys.sharedTx.length).toBe(32)
  })
})

describe('Asymmetric Encryption and Decryption Tests', () => {
  test('encryptAsymmetric and decryptAsymmetric return original plaintext', async () => {
    const testPlaintext =
      "Saigon, I'm still only in Saigon. Every time I think I'm gonna wake up back in the jungle.."
    const keyPair = await randomKeyPair()
    const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex')
    const privateKeyHex = Buffer.from(keyPair.privateKey).toString('hex')

    const encryptedData = await encryptAsymmetric(testPlaintext, publicKeyHex)
    const decryptedData = await decryptAsymmetric(encryptedData, privateKeyHex, publicKeyHex)

    // Regex to match the encrypted data pattern
    const pattern = new RegExp(`ph:v${VERSION}:[0-9a-fA-F]{64}:.+`)
    expect(encryptedData).toMatch(pattern)
    expect(decryptedData).toBe(testPlaintext)
  })
})

describe('BLAKE2b Digest Tests', () => {
  test('digest produces correct length hash', async () => {
    const inputStr = 'test string'
    const salt = 'salt'
    const result = await digest(inputStr, salt)
    expect(result.length).toBe(64)
  })

  test('digest is consistent for same input and salt', async () => {
    const inputStr = 'consistent input'
    const salt = 'consistent salt'
    const hash1 = await digest(inputStr, salt)
    const hash2 = await digest(inputStr, salt)
    expect(hash1).toBe(hash2)
  })

  test('digest is unique with different inputs', async () => {
    const salt = 'salt'
    const hash1 = await digest('input1', salt)
    const hash2 = await digest('input2', salt)
    expect(hash1).not.toBe(hash2)
  })

  test('digest is unique with different salts', async () => {
    const inputStr = 'input'
    const hash1 = await digest(inputStr, 'salt1')
    const hash2 = await digest(inputStr, 'salt2')
    expect(hash1).not.toBe(hash2)
  })

  const knownHashes = [
    {
      inputStr: 'hello',
      salt: 'world',
      expectedHash: '38010cfe3a8e684cb17e6d049525e71d4e9dc3be173fc05bf5c5ca1c7e7c25e7',
    },
    {
      inputStr: 'another test',
      salt: 'another salt',
      expectedHash: '5afad949edcfb22bd24baeed4e75b0aeca41731b8dff78f989a5a4c0564f211f',
    },
  ]

  knownHashes.forEach(({ inputStr, salt, expectedHash }) => {
    test(`digest produces known hash for input "${inputStr}" and salt "${salt}"`, async () => {
      const result = await digest(inputStr, salt)
      expect(result).toBe(expectedHash)
    })
  })
})

describe('Salt From String Tests', () => {
  test('saltFromString produces 16-byte salt', async () => {
    const input = 'test input'
    const salt = await saltFromString(input)
    expect(salt.length).toBe(16)
  })

  test('saltFromString is consistent for the same input', async () => {
    const input = 'consistent input'
    const salt1 = await saltFromString(input)
    const salt2 = await saltFromString(input)
    expect(salt1).toEqual(salt2)
  })

  test('saltFromString produces unique salts for different inputs', async () => {
    const salt1 = await saltFromString('input1')
    const salt2 = await saltFromString('input2')
    expect(salt1).not.toEqual(salt2)
  })
})

describe('XChaCha20-Poly1305 Encrypt and Decrypt Tests', () => {
  test('encryptRaw returns ciphertext with appended nonce', async () => {
    const plaintext = 'test message'
    const key = new Uint8Array(32) // 256-bit key
    const result = await encryptRaw(plaintext, key)

    // Nonce length for XChaCha20-Poly1305 is 24 bytes
    const nonceLength = 24
    expect(result.length).toBeGreaterThan(plaintext.length + nonceLength)
  })

  test('encryptRaw produces different ciphertexts for the same input', async () => {
    const plaintext = 'consistent message'
    const key = new Uint8Array(32) // 256-bit key
    const ciphertext1 = await encryptRaw(plaintext, key)
    const ciphertext2 = await encryptRaw(plaintext, key)

    expect(ciphertext1).not.toEqual(ciphertext2) // Different due to random nonce
  })

  test('nonce is of correct length', async () => {
    const plaintext = 'message for nonce test'
    const key = new Uint8Array(32) // 256-bit key
    const result = await encryptRaw(plaintext, key)

    // Extracting nonce from the end of the ciphertext
    const nonceLength = 24
    const nonce = result.slice(-nonceLength)
    expect(nonce.length).toBe(nonceLength)
  })

  test('decryptRaw correctly decrypts a message encrypted by encryptRaw', async () => {
    const plaintext = 'test message'
    const key = new Uint8Array(32) // 256-bit key
    const encryptedMessage = await encryptRaw(plaintext, key)
    const decryptedMessage = await decryptRaw(encryptedMessage, key)

    expect(new TextDecoder().decode(decryptedMessage)).toBe(plaintext)
  })

  test('decryptRaw with incorrect key fails', async () => {
    const plaintext = 'test message for wrong key'
    const correctKey = new Uint8Array(32)
    const wrongKey = new Uint8Array(32).fill(1) // Incorrect key
    const encryptedMessage = await encryptRaw(plaintext, correctKey)

    await expect(decryptRaw(encryptedMessage, wrongKey)).rejects.toThrow()
  })
})

describe('String Encryption and Decryption Tests', () => {
  test('encryptString returns base64 string and decryptString retrieves original plaintext', async () => {
    const plaintext = 'Hello, world!'
    const key = new Uint8Array(32) // 256-bit key

    const encryptedString = await encryptString(plaintext, key)
    expect(encryptedString).toMatch(/^[A-Za-z0-9+/]+={0,2}$/) // Regex for base64 format

    const decryptedString = await decryptString(encryptedString, key)
    expect(decryptedString).toBe(plaintext)
  })

  test('decryptString with incorrect base64 string fails', async () => {
    const incorrectCiphertext = 'invalid base64 string'
    const key = new Uint8Array(32)

    await expect(decryptString(incorrectCiphertext, key)).rejects.toThrow()
  })

  test('decryptString with incorrect key fails', async () => {
    const plaintext = 'Sensitive data'
    const correctKey = new Uint8Array(32)
    const wrongKey = new Uint8Array(32).fill(1) // Incorrect key

    const encryptedString = await encryptString(plaintext, correctKey)
    await expect(decryptString(encryptedString, wrongKey)).rejects.toThrow()
  })
})
