import _sodium from 'libsodium-wrappers-sumo'
/**
 * Computes the xor of two Uint8Arrays, byte by byte and returns the result
 *
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {Uint8Array} The xor of Uint8Arrays a and b
 */
const xorUint8Arrays = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  return Uint8Array.from(a.map((byte, i) => byte ^ b[i]))
}

/**
 * Computes a set of shares that can be recombined to obtain the given secret
 *
 * @param {Uint8Array} secret The secret to be split
 * @param {number} shares The number of shares to create
 * @returns {string[]} The shares as hex-encoded strings
 */
export const splitSecret = async (secret: string): Promise<string[]> => {
  const NUMSHARES = 2

  await _sodium.ready
  const sodium = _sodium
  const shares: Uint8Array[] = []

  const secretBytes = sodium.from_hex(secret)

  for (let i = 0; i < NUMSHARES - 1; i++) {
    shares.push(sodium.randombytes_buf(secretBytes.length))
  }

  const lastShare = shares.reduce((prev, curr) => xorUint8Arrays(prev, curr), secretBytes)
  shares.push(lastShare)

  return shares.map((share) => sodium.to_hex(share))
}
