/**
 * @jest-environment node
 */

/*
  👆
  overrides: testEnvironment: 'jsdom' in jest.config.js
  to fix: ReferenceError: TextDecoder is not defined
*/

/*
  Regression test for the environment-switch race described in the PR that
  added this file. It does not mount the page component (that needs Apollo,
  Next navigation and the keyring context, none of which are set up in this
  suite); instead it proves the property the fix in
  app/[team]/apps/[app]/environments/[environment]/[[...path]]/page.tsx
  relies on, using the real crypto primitives: decryptAsymmetric rejects,
  rather than silently returning garbage, when the keypair does not match the
  ciphertext's session.

  That is why the original unguarded effect (pairing one environment's `data`
  with another environment's `envKeys` while the correct keys were still
  being derived) surfaced as a promise rejection, and why the missing
  `.catch()` on that call turned it into an unhandled rejection that left
  `decrypting` stuck at `true` with no way to recover short of a reload.
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

    // This is the exact operation the page performs when envKeys still holds
    // environment B's keys while data has already updated to environment A's
    // secrets (or vice versa): decrypting A's ciphertext with B's keypair.
    await expect(decryptAsymmetric(ciphertext, envB.privateKey, envB.publicKey)).rejects.toBeDefined()

    // Decrypting with the matching keypair still works, so the rejection
    // above is specifically about the key mismatch, not a broken fixture.
    const decrypted = await decryptAsymmetric(ciphertext, envA.privateKey, envA.publicKey)
    expect(decrypted).toBe('super-secret-value')
  })
})
