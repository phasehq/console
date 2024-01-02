import { splitSecret } from '@/utils/keyshares';
import _sodium from 'libsodium-wrappers-sumo';

const xorUint8Arrays = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  return Uint8Array.from(a.map((byte, i) => byte ^ b[i]));
};

describe('Split Secret Tests', () => {
  beforeAll(async () => {
    await _sodium.ready;
  });

  test('splitSecret generates correct number of shares t=n', async () => {
    const secret = '00ad975d1546261e2a3c43ab871b704707b52b1f1040e5ea084a190d07353968';
    const shares = await splitSecret(secret);
    expect(shares.length).toBe(2);
  });
  
  test('recombining shares retrieves the original secret', async () => {
    const secret = '35afb4e762109388ac7fefd26d6729b35102b90916c4a0115a426016adba512b';
    const shares = await splitSecret(secret);
    const recombined = shares.reduce((prev, curr, idx) => {
      return idx === 0 ? _sodium.from_hex(curr) : xorUint8Arrays(prev, _sodium.from_hex(curr));
    }, new Uint8Array());
    expect(_sodium.to_hex(recombined)).toBe(secret);
  });
  
  test('xorUint8Arrays correctly computes XOR', () => {
    const array1 = new Uint8Array([1, 2, 3]);
    const array2 = new Uint8Array([3, 2, 1]);
    const expectedXor = new Uint8Array([2, 0, 2]);
    const result = xorUint8Arrays(array1, array2);
    expect(result).toEqual(expectedXor);
  });

  const secret = '2060bdd9b7f14563a788ba2568f9ffd7f406952115209ade6037f5342302e85e';

  test('cannot reconstruct secret with a corrupted share', async () => {
    const shares = await splitSecret(secret);
    // Corrupt one share
    const corruptedShare = shares[0].substring(0, shares[0].length - 1) + '0';
    const recombined = xorUint8Arrays(
      _sodium.from_hex(corruptedShare),
      _sodium.from_hex(shares[1])
    );
    expect(_sodium.to_hex(recombined)).not.toBe(secret);
  });

  test('cannot reconstruct secret with only one share', async () => {
    const shares = await splitSecret(secret);
    // Try reconstructing with only one share
    const recombined = _sodium.from_hex(shares[0]);
    expect(_sodium.to_hex(recombined)).not.toBe(secret);
  });

  test('all shares have the same length', async () => {
    const shares = await splitSecret(secret);
    const length = shares[0].length;
    expect(shares.every(share => share.length === length)).toBe(true);
  });

  test('each share is unique', async () => {
    const shares = await splitSecret(secret);
    const uniqueShares = new Set(shares);
    expect(uniqueShares.size).toBe(shares.length);
  });

  test('reconstructs secret correctly with correct shares', async () => {
    const shares = await splitSecret(secret);
    const recombined = shares.reduce((prev, curr, idx) => {
      return idx === 0 ? _sodium.from_hex(curr) : xorUint8Arrays(prev, _sodium.from_hex(curr));
    }, new Uint8Array());
    expect(_sodium.to_hex(recombined)).toBe(secret);
  });
});
