import {
  randomKeyPair,
  clientSessionKeys,
  encryptAsymmetric,
} from '../utils/crypto';

import * as sodium from 'libsodium-wrappers-sumo';  // <-- Import sodium

// Mocking libsodium-wrappers-sumo
jest.mock('libsodium-wrappers-sumo', () => ({
  ready: Promise.resolve(),
  crypto_kx_keypair: jest.fn().mockResolvedValue({
    publicKey: Uint8Array.from([1, 2, 3]),
    privateKey: Uint8Array.from([4, 5, 6])
  }),
  from_hex: jest.fn(),
  crypto_kx_client_session_keys: jest.fn(),
  randombytes_buf: jest.fn().mockReturnValue(Uint8Array.from([/* some random bytes */])),
  crypto_aead_xchacha20poly1305_ietf_encrypt: jest.fn().mockReturnValue(Uint8Array.from([/* some bytes representing encrypted data */])),
  to_hex: jest.fn().mockImplementation((data: Uint8Array) => {
    return Array.from(data).map(byte => byte.toString(16)).join('');
  }),
  // ... other mocks
}));

const mockEncryptString = jest.fn();

jest.doMock('./../utils/crypto', () => {
  return {
    ...jest.requireActual('./../utils/crypto'),
    encryptString: mockEncryptString
  };
});

describe('encryptAsymmetric', () => {
  let publicKeyInHex: string;
  let privateKeyInHex: string;

  beforeAll(async () => {
    await sodium.ready;  // <-- Ensure sodium is ready

    const keyPair = await randomKeyPair();
    console.log("Returned keyPair:", keyPair);
    
    // Use sodium.to_hex() to convert keys to hex
    publicKeyInHex = sodium.to_hex(keyPair.publicKey);
    privateKeyInHex = sodium.to_hex(keyPair.privateKey);

    console.log('Public Key (Hex):', publicKeyInHex);
    console.log('Private Key (Hex):', privateKeyInHex);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should encrypt a plaintext string asymmetrically', async () => {
    const mockKeyPair = {
      publicKey: Uint8Array.from([1, 2, 3]),
      privateKey: Uint8Array.from([4, 5, 6]),
    };
    const mockSymmetricKeys = {
      sharedTx: Uint8Array.from([7, 8, 9]),
      sharedRx: Uint8Array.from([10, 11, 12]),
    };
    const mockCiphertext = 'encrypted_data';

    require('libsodium-wrappers-sumo').crypto_kx_keypair.mockResolvedValueOnce(mockKeyPair);
    require('libsodium-wrappers-sumo').from_hex.mockImplementation((data: string) => Uint8Array.from(data.split('').map((char: string) => char.charCodeAt(0))));
    require('libsodium-wrappers-sumo').crypto_kx_client_session_keys.mockResolvedValueOnce(mockSymmetricKeys);
    mockEncryptString.mockResolvedValueOnce(mockCiphertext);

    const plaintext = 'hello world';

    const result = await encryptAsymmetric(plaintext, publicKeyInHex);

    expect(result).toContain('ph:v1');
    expect(result).toContain('encrypted_data');
  });
});

