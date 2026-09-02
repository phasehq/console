/**
 * @jest-environment node
 */

/*
  👆
  overrides: testEnvironment: 'jsdom' in jest.config.js
  to fix: ReferenceError: TextDecoder is not defined
*/

/*
  Proves the property the environment-switch fix relies on: decryptAsymmetric
  rejects, rather than returning garbage, when the keypair does not match the
  ciphertext.
*/

import { decryptAsymmetric, encryptAsymmetric, randomKeyPair } from '@/utils/crypto'

const toHexKeyPair = (keyPair: { publicKey: Uint8Array; privateKey: Uint8Array }) => ({
  publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
  privateKey: Buffer.from(keyPair.privateKey).toString('hex'),
})

describe("Environment key race (decrypting one environment's secrets with another's keys)", () => {
  test('decrypting with a mismatched keypair rejects rather than returning garbage', async () => {
    const envA = toHexKeyPair(await randomKeyPair())
    const envB = toHexKeyPair(await randomKeyPair())

    const ciphertext = await encryptAsymmetric('super-secret-value', envA.publicKey)

    // What the page did when envKeys still held B's keys and data was A's.
    await expect(decryptAsymmetric(ciphertext, envB.privateKey, envB.publicKey)).rejects.toBeDefined()

    // The matching keypair still works, so the rejection is the mismatch.
    const decrypted = await decryptAsymmetric(ciphertext, envA.privateKey, envA.publicKey)
    expect(decrypted).toBe('super-secret-value')
  })
})
