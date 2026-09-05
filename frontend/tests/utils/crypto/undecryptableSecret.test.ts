/**
 * @jest-environment node
 */

/*
  Regression test for #948: one secret with unreadable ciphertext used to
  reject the whole Promise.all batch, so the environment page never loaded
  for any user. Promise.allSettled keeps the readable rows.
*/

import { decryptAsymmetric, encryptAsymmetric, randomKeyPair } from '@/utils/crypto'

const toHexKeyPair = (keyPair: { publicKey: Uint8Array; privateKey: Uint8Array }) => ({
  publicKey: Buffer.from(keyPair.publicKey).toString('hex'),
  privateKey: Buffer.from(keyPair.privateKey).toString('hex'),
})

describe('Undecryptable secret in a batch', () => {
  test('a corrupt row rejects on its own without taking the batch down', async () => {
    const env = toHexKeyPair(await randomKeyPair())

    const good = await encryptAsymmetric('readable-value', env.publicKey)

    // The reported corruption: the ciphertext was truncated at write time,
    // leaving the base64 segment with length % 4 === 1, which sodium rejects.
    const corrupt = good.slice(0, good.length - (good.length % 4) - 3)

    await expect(
      decryptAsymmetric(corrupt, env.privateKey, env.publicKey)
    ).rejects.toBeDefined()

    // Promise.all is what the page used to do: one rejection loses everything.
    await expect(
      Promise.all([
        decryptAsymmetric(good, env.privateKey, env.publicKey),
        decryptAsymmetric(corrupt, env.privateKey, env.publicKey),
        decryptAsymmetric(good, env.privateKey, env.publicKey),
      ])
    ).rejects.toBeDefined()

    // allSettled keeps the rows that decrypted and isolates the one that did not.
    const results = await Promise.allSettled([
      decryptAsymmetric(good, env.privateKey, env.publicKey),
      decryptAsymmetric(corrupt, env.privateKey, env.publicKey),
      decryptAsymmetric(good, env.privateKey, env.publicKey),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled).toHaveLength(2)
    expect(rejected).toHaveLength(1)
    expect((fulfilled[0] as PromiseFulfilledResult<string>).value).toBe('readable-value')
  })
})
