/**
 * @jest-environment node
 */

/*
  👆 
  overrides: testEnvironment: 'jsdom' in jest.config.js
  to fix: ReferenceError: TextDecoder is not defined
  
*/

import {
  randomKeyPair,
  clientSessionKeys,
  serverSessionKeys,
  encryptAsymmetric,
  decryptAsymmetric,
  digest,
  VERSION,
} from '@/utils/crypto';

import { cryptoUtils } from '@/utils/auth';

import _sodium from 'libsodium-wrappers-sumo';


describe('Crypto Utils Tests', () => {
  test('randomKeyPair generates keys of correct length', async () => {
    const keyPair = await randomKeyPair();
    expect(keyPair.publicKey.length).toBe(32);
    expect(keyPair.privateKey.length).toBe(32);
  });

  test('clientSessionKeys generates keys of correct length', async () => {
    const clientKeyPair = await randomKeyPair();
    const serverKeyPair = await randomKeyPair();
    const clientKeys = await clientSessionKeys(clientKeyPair, serverKeyPair.publicKey);
    expect(clientKeys.sharedRx.length).toBe(32);
    expect(clientKeys.sharedTx.length).toBe(32);
  });

  test('serverSessionKeys generates keys of correct length', async () => {
    const serverKeyPair = await randomKeyPair();
    const clientKeyPair = await randomKeyPair();
    const serverKeys = await serverSessionKeys(serverKeyPair, clientKeyPair.publicKey);
    expect(serverKeys.sharedRx.length).toBe(32);
    expect(serverKeys.sharedTx.length).toBe(32);
  });

});

describe('Asymmetric Encryption and Decryption Tests', () => {
  test('encryptAsymmetric and decryptAsymmetric return original plaintext', async () => {
    const testPlaintext = "Saigon, I'm still only in Saigon. Every time I think I'm gonna wake up back in the jungle..";
    const keyPair = await randomKeyPair();
    const publicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');
    const privateKeyHex = Buffer.from(keyPair.privateKey).toString('hex');

    const encryptedData = await encryptAsymmetric(testPlaintext, publicKeyHex);
    const decryptedData = await decryptAsymmetric(encryptedData, privateKeyHex, publicKeyHex);

    // Regex to match the encrypted data pattern
    const pattern = new RegExp(`ph:v${VERSION}:[0-9a-fA-F]{64}:.+`);
    expect(encryptedData).toMatch(pattern);
    expect(decryptedData).toBe(testPlaintext);
  });
});

describe('BLAKE2b Digest Tests', () => {
  test('digest produces correct length hash', async () => {
    const inputStr = "test string";
    const salt = "salt";
    const result = await digest(inputStr, salt);
    expect(result.length).toBe(64);
  });

  test('digest is consistent for same input and salt', async () => {
    const inputStr = "consistent input";
    const salt = "consistent salt";
    const hash1 = await digest(inputStr, salt);
    const hash2 = await digest(inputStr, salt);
    expect(hash1).toBe(hash2);
  });

  test('digest is unique with different inputs', async () => {
    const salt = "salt";
    const hash1 = await digest("input1", salt);
    const hash2 = await digest("input2", salt);
    expect(hash1).not.toBe(hash2);
  });

  test('digest is unique with different salts', async () => {
    const inputStr = "input";
    const hash1 = await digest(inputStr, "salt1");
    const hash2 = await digest(inputStr, "salt2");
    expect(hash1).not.toBe(hash2);
  });

  const knownHashes = [
    { inputStr: "hello", salt: "world", expectedHash: "38010cfe3a8e684cb17e6d049525e71d4e9dc3be173fc05bf5c5ca1c7e7c25e7" },
    { inputStr: "another test", salt: "another salt", expectedHash: "5afad949edcfb22bd24baeed4e75b0aeca41731b8dff78f989a5a4c0564f211f" },
  ];

  knownHashes.forEach(({ inputStr, salt, expectedHash }) => {
    test(`digest produces known hash for input "${inputStr}" and salt "${salt}"`, async () => {
      const result = await digest(inputStr, salt);
      expect(result).toBe(expectedHash);
    });
  });
});


describe('Salt From String Tests', () => {
  test('saltFromString produces 16-byte salt', async () => {
    const input = "test input";
    const salt = await cryptoUtils.saltFromString(input);
    expect(salt.length).toBe(16);
  });

  test('saltFromString is consistent for the same input', async () => {
    const input = "consistent input";
    const salt1 = await cryptoUtils.saltFromString(input);
    const salt2 = await cryptoUtils.saltFromString(input);
    expect(salt1).toEqual(salt2);
  });

  test('saltFromString produces unique salts for different inputs', async () => {
    const salt1 = await cryptoUtils.saltFromString("input1");
    const salt2 = await cryptoUtils.saltFromString("input2");
    expect(salt1).not.toEqual(salt2);
  });
});

describe('XChaCha20-Poly1305 Encrypt and Decrypt Tests', () => {
  test('encryptRaw returns ciphertext with appended nonce', async () => {
    const plaintext = "test message";
    const key = new Uint8Array(32); // 256-bit key
    const result = await cryptoUtils.encryptRaw(plaintext, key);

    // Nonce length for XChaCha20-Poly1305 is 24 bytes
    const nonceLength = 24;
    expect(result.length).toBeGreaterThan(plaintext.length + nonceLength);
  });

  test('encryptRaw produces different ciphertexts for the same input', async () => {
    const plaintext = "consistent message";
    const key = new Uint8Array(32); // 256-bit key
    const ciphertext1 = await cryptoUtils.encryptRaw(plaintext, key);
    const ciphertext2 = await cryptoUtils.encryptRaw(plaintext, key);

    expect(ciphertext1).not.toEqual(ciphertext2); // Different due to random nonce
  });

  test('nonce is of correct length', async () => {
    const plaintext = "message for nonce test";
    const key = new Uint8Array(32); // 256-bit key
    const result = await cryptoUtils.encryptRaw(plaintext, key);

    // Extracting nonce from the end of the ciphertext
    const nonceLength = 24;
    const nonce = result.slice(-nonceLength);
    expect(nonce.length).toBe(nonceLength);
  });

  test('decryptRaw correctly decrypts a message encrypted by encryptRaw', async () => {
    const plaintext = "test message";
    const key = new Uint8Array(32); // 256-bit key
    const encryptedMessage = await cryptoUtils.encryptRaw(plaintext, key);
    const decryptedMessage = await cryptoUtils.decryptRaw(encryptedMessage, key);

    expect(new TextDecoder().decode(decryptedMessage)).toBe(plaintext);
  });

  test('decryptRaw with incorrect key fails', async () => {
    const plaintext = "test message for wrong key";
    const correctKey = new Uint8Array(32);
    const wrongKey = new Uint8Array(32).fill(1); // Incorrect key
    const encryptedMessage = await cryptoUtils.encryptRaw(plaintext, correctKey);

    await expect(cryptoUtils.decryptRaw(encryptedMessage, wrongKey)).rejects.toThrow();
  });
});

describe('String Encryption and Decryption Tests', () => {
  test('encryptString returns base64 string and decryptString retrieves original plaintext', async () => {
    const plaintext = "Hello, world!";
    const key = new Uint8Array(32); // 256-bit key

    const encryptedString = await cryptoUtils.encryptString(plaintext, key);
    expect(encryptedString).toMatch(/^[A-Za-z0-9+/]+={0,2}$/); // Regex for base64 format

    const decryptedString = await cryptoUtils.decryptString(encryptedString, key);
    expect(decryptedString).toBe(plaintext);
  });

  test('decryptString with incorrect base64 string fails', async () => {
    const incorrectCiphertext = "invalid base64 string";
    const key = new Uint8Array(32);

    await expect(cryptoUtils.decryptString(incorrectCiphertext, key)).rejects.toThrow();
  });

  test('decryptString with incorrect key fails', async () => {
    const plaintext = "Sensitive data";
    const correctKey = new Uint8Array(32);
    const wrongKey = new Uint8Array(32).fill(1); // Incorrect key

    const encryptedString = await cryptoUtils.encryptString(plaintext, correctKey);
    await expect(cryptoUtils.decryptString(encryptedString, wrongKey)).rejects.toThrow();
  });
});

describe('Organisation Seed Generation Tests', () => {
  test('organisationSeed produces consistent output for same inputs', async () => {
    const mnemonic = "junk eagle stock health body hurry unfold square rather edit sword infant glide alcohol october hope wink tent mask hedgehog purity lonely note concert";
    const orgId = "e1c22c4f-62f6-4f7e-9faa-cbf8653ab976";

    const seed1 = await cryptoUtils.organisationSeed(mnemonic, orgId);
    const seed2 = await cryptoUtils.organisationSeed(mnemonic, orgId);
    expect(seed1).toEqual(seed2);
  });

  test('organisationSeed output is 32 bytes', async () => {
    const mnemonic = "provide love harvest easily saddle annual element engage october donate box devote upon simple cruise wage normal wine crisp health average reason uphold copper";
    const orgId = "e7a561f0-01b2-4430-b99f-0f2a3bdb11cb";

    const seed = await cryptoUtils.organisationSeed(mnemonic, orgId);
    expect(seed.length).toBe(32);
  });

  test('organisationSeed produces different outputs for different inputs', async () => {
    const mnemonic1 = "recall seed gorilla accuse fade blade fever legend scan load token educate upgrade fragile keen peanut panther suit sword net armed staff torch holiday";
    const mnemonic2 = "walnut impulse repair pool vanish goddess own gesture wine galaxy vicious attract scissors stem talk orient pause maple cage talk trick gap jeans payment";
    const orgId = "34e26348-a5be-4f01-80aa-902ee8564354";

    const seed1 = await cryptoUtils.organisationSeed(mnemonic1, orgId);
    const seed2 = await cryptoUtils.organisationSeed(mnemonic2, orgId);
    expect(seed1).not.toEqual(seed2);
  });

  test('organisationSeed is case sensitive', async () => {
    const mnemonic = "recall seed gorilla accuse fade blade fever legend scan load token educate upgrade fragile keen peanut panther suit sword net armed staff torch holiday";
    const orgId = "a4f57f35-2310-4448-8180-c39c5a45f3a1";

    const seed1 = await cryptoUtils.organisationSeed(mnemonic, orgId);
    const seed2 = await cryptoUtils.organisationSeed(mnemonic.toUpperCase(), orgId);
    expect(seed1).not.toEqual(seed2);
  });
});


describe('Organisation Keyring Tests', () => {
  const seed = new Uint8Array(32).fill(1); // Example seed

  test('organisationKeyring produces consistent keys for same seed', async () => {
    const keyring1 = await cryptoUtils.organisationKeyring(seed);
    const keyring2 = await cryptoUtils.organisationKeyring(seed);
    expect(keyring1).toEqual(keyring2);
  });

  test('keys are of correct lengths', async () => {
    const keyring = await cryptoUtils.organisationKeyring(seed);
    expect(keyring.symmetricKey.length).toBe(64); // Length in hex representation
    expect(keyring.privateKey.length).toBeGreaterThan(64);
    expect(keyring.publicKey.length).toBeGreaterThan(32);
  });

  test('different seeds produce different keys', async () => {
    const differentSeed = new Uint8Array(32).fill(2);
    const keyring1 = await cryptoUtils.organisationKeyring(seed);
    const keyring2 = await cryptoUtils.organisationKeyring(differentSeed);
    expect(keyring1).not.toEqual(keyring2);
  });

  test('symmetric key and signing keys are derived independently', async () => {
    const keyring = await cryptoUtils.organisationKeyring(seed);
    expect(keyring.symmetricKey).not.toBe(keyring.privateKey);
    expect(keyring.symmetricKey).not.toBe(keyring.publicKey);
  });

  test('keys adhere to respective formats', async () => {
    const keyring = await cryptoUtils.organisationKeyring(seed);
    expect(keyring.symmetricKey).toMatch(/^[a-f0-9]{64}$/);
    expect(keyring.privateKey).toMatch(/^[a-f0-9]+$/);
    expect(keyring.publicKey).toMatch(/^[a-f0-9]+$/);
  });
});

describe('Device Vault Key Tests', () => {
  const password = "correct-horse-staple-battery";
  const email = "satoshi@gmx.com";

  test('deviceVaultKey produces consistent key for same inputs', async () => {
    const key1 = await cryptoUtils.deviceVaultKey(password, email);
    const key2 = await cryptoUtils.deviceVaultKey(password, email);
    expect(key1).toBe(key2);
  });

  test('deviceVaultKey output is hex string of correct length', async () => {
    const key = await cryptoUtils.deviceVaultKey(password, email);
    expect(key).toMatch(/^[a-f0-9]{64}$/); // 32 Byte Hex string - 64 characters
  });

  test('different passwords produce different keys', async () => {
    const differentPassword = "incorrect-horse-staple-battery";
    const key1 = await cryptoUtils.deviceVaultKey(password, email);
    const key2 = await cryptoUtils.deviceVaultKey(differentPassword, email);
    expect(key1).not.toBe(key2);
  });

  test('different emails produce different keys', async () => {
    const differentEmail = "nakamoto@gmx.com";
    const key1 = await cryptoUtils.deviceVaultKey(password, email);
    const key2 = await cryptoUtils.deviceVaultKey(password, differentEmail);
    expect(key1).not.toBe(key2);
  });

  test('small changes in input produce significantly different keys', async () => {
    const key1 = await cryptoUtils.deviceVaultKey(password, email);
    const key2 = await cryptoUtils.deviceVaultKey(password + "a", email);
    const key3 = await cryptoUtils.deviceVaultKey(password, email + "a");
    expect(key1).not.toBe(key2);
    expect(key1).not.toBe(key3);
  });
});



describe('Account Keyring Encryption and Decryption Tests', () => {
  const exampleKeyring = {
    symmetricKey: 'a1b2c3d4e5f6g7h8i9j0',
    privateKey: 'privatekeyexample',
    publicKey: 'publickeyexample'
  };

  const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 64-character hex string

  test('encryptAccountKeyring returns hex encoded string', async () => {
    const encryptedKeyring = await cryptoUtils.encryptAccountKeyring(exampleKeyring, encryptionKey);
    expect(encryptedKeyring).toMatch(/^[a-f0-9]+$/);
  });

  test('decryptAccountKeyring retrieves original keyring', async () => {
    const encryptedKeyring = await cryptoUtils.encryptAccountKeyring(exampleKeyring, encryptionKey);
    const decryptedKeyring = await cryptoUtils.decryptAccountKeyring(encryptedKeyring, encryptionKey);
    expect(decryptedKeyring).toEqual(exampleKeyring);
  });

  test('decryptAccountKeyring with incorrect key fails', async () => {
    const encryptedKeyring = await cryptoUtils.encryptAccountKeyring(exampleKeyring, encryptionKey);
    const wrongKey = 'f1e2d3c4b5a697887766554433221100ffeeddccbbaa99887766554433221100';

    await expect(cryptoUtils.decryptAccountKeyring(encryptedKeyring, wrongKey)).rejects.toThrow();
  });

  test('decryptAccountKeyring with incorrect encrypted keyring fails', async () => {
    const incorrectEncryptedKeyring = 'abcdef';

    await expect(cryptoUtils.decryptAccountKeyring(incorrectEncryptedKeyring, encryptionKey)).rejects.toThrow();
  });
});

describe('Account Recovery Encryption and Decryption Tests', () => {
  const exampleMnemonic = "test mnemonic phrase for encryption";
  const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // 64-character hex string

  test('encryptAccountRecovery returns hex encoded string', async () => {
    const encryptedRecovery = await cryptoUtils.encryptAccountRecovery(exampleMnemonic, encryptionKey);
    expect(encryptedRecovery).toMatch(/^[a-f0-9]+$/);
  });

  test('decryptAccountRecovery retrieves original mnemonic', async () => {
    const encryptedRecovery = await cryptoUtils.encryptAccountRecovery(exampleMnemonic, encryptionKey);
    const decryptedRecovery = await cryptoUtils.decryptAccountRecovery(encryptedRecovery, encryptionKey);
    expect(decryptedRecovery).toBe(exampleMnemonic);
  });

  test('decryptAccountRecovery with incorrect key fails', async () => {
    const encryptedRecovery = await cryptoUtils.encryptAccountRecovery(exampleMnemonic, encryptionKey);
    const wrongKey = 'f1e2d3c4b5a697887766554433221100ffeeddccbbaa99887766554433221100';

    await expect(cryptoUtils.decryptAccountRecovery(encryptedRecovery, wrongKey)).rejects.toThrow();
  });

  test('decryptAccountRecovery with incorrect encrypted mnemonic fails', async () => {
    const incorrectEncryptedRecovery = 'abcdef';

    await expect(cryptoUtils.decryptAccountRecovery(incorrectEncryptedRecovery, encryptionKey)).rejects.toThrow();
  });
});

describe('New App Key Generation Tests', () => {
  const expectedHexLength = 64; // Keygen returns 32 bytes

  test('newAppSeed returns hex string of correct length', async () => {
    const seed = await cryptoUtils.newAppSeed();
    expect(seed).toMatch(/^[a-f0-9]{64}$/);
    expect(seed.length).toBe(expectedHexLength);
  });

  test('newAppSeed produces unique seeds', async () => {
    const seed1 = await cryptoUtils.newAppSeed();
    const seed2 = await cryptoUtils.newAppSeed();
    expect(seed1).not.toBe(seed2);
  });

  test('newAppToken returns hex string of correct length', async () => {
    const token = await cryptoUtils.newAppToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(token.length).toBe(expectedHexLength);
  });

  test('newAppToken produces unique tokens', async () => {
    const token1 = await cryptoUtils.newAppToken();
    const token2 = await cryptoUtils.newAppToken();
    expect(token1).not.toBe(token2);
  });

  test('newAppWrapKey returns hex string of correct length', async () => {
    const key = await cryptoUtils.newAppWrapKey();
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key.length).toBe(expectedHexLength);
  });

  test('newAppWrapKey produces unique keys', async () => {
    const key1 = await cryptoUtils.newAppWrapKey();
    const key2 = await cryptoUtils.newAppWrapKey();
    expect(key1).not.toBe(key2);
  });
});

describe('App Seed Encryption and Decryption Tests', () => {
  const exampleSeed = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // Example seed, 64-character hex string
  const encryptionKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'; // Example key, 64-character hex string

  test('encryptedAppSeed returns hex encoded string', async () => {
    const encryptedSeed = await cryptoUtils.encryptedAppSeed(exampleSeed, encryptionKey);
    expect(encryptedSeed).toMatch(/^[a-f0-9]+$/);
  });

  test('decryptedAppSeed retrieves original seed', async () => {
    const encryptedSeed = await cryptoUtils.encryptedAppSeed(exampleSeed, encryptionKey);
    const decryptedSeed = await cryptoUtils.decryptedAppSeed(encryptedSeed, encryptionKey);
    expect(decryptedSeed).toBe(exampleSeed);
  });

  test('decryptedAppSeed with incorrect key fails', async () => {
    const encryptedSeed = await cryptoUtils.encryptedAppSeed(exampleSeed, encryptionKey);
    const wrongKey = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

    await expect(cryptoUtils.decryptedAppSeed(encryptedSeed, wrongKey)).rejects.toThrow();
  });

  test('decryptedAppSeed with incorrect encrypted seed fails', async () => {
    const incorrectEncryptedSeed = 'abcdef';

    await expect(cryptoUtils.decryptedAppSeed(incorrectEncryptedSeed, encryptionKey)).rejects.toThrow();
  });
});

describe('App Keyring Derivation Tests', () => {
  const exampleSeed = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // Example seed, 64-character hex string

  test('appKeyring produces consistent key pair for same seed', async () => {
    const keyring1 = await cryptoUtils.appKeyring(exampleSeed);
    const keyring2 = await cryptoUtils.appKeyring(exampleSeed);
    expect(keyring1).toEqual(keyring2);
  });

  test('key pair is in hex format and of correct lengths', async () => {
    const keyring = await cryptoUtils.appKeyring(exampleSeed);
    expect(keyring.publicKey).toMatch(/^[a-f0-9]+$/);
    expect(keyring.privateKey).toMatch(/^[a-f0-9]+$/);
    // Length check depends on the specific key length your implementation uses
  });

  test('different seeds produce different key pairs', async () => {
    const differentSeed = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    const keyring1 = await cryptoUtils.appKeyring(exampleSeed);
    const keyring2 = await cryptoUtils.appKeyring(differentSeed);
    expect(keyring1).not.toEqual(keyring2);
  });

});

describe('Wrapped Key Share Tests', () => {
  const exampleKeyShare = 'examplekeysharedata';
  const wrapKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'; // Example wrap key, 64-character hex string

  test('wrappedKeyShare returns hex encoded string', async () => {
    const wrappedShare = await cryptoUtils.wrappedKeyShare(exampleKeyShare, wrapKey);
    expect(wrappedShare).toMatch(/^[a-f0-9]+$/);
  });

  test('wrappedKeyShare produces unique output for same input', async () => {
    const wrappedShare1 = await cryptoUtils.wrappedKeyShare(exampleKeyShare, wrapKey);
    const wrappedShare2 = await cryptoUtils.wrappedKeyShare(exampleKeyShare, wrapKey);
    expect(wrappedShare1).not.toBe(wrappedShare2); // Different due to random nonce
  });

  test('different key shares produce different outputs', async () => {
    const differentKeyShare = 'differentkeysharedata';
    const wrappedShare1 = await cryptoUtils.wrappedKeyShare(exampleKeyShare, wrapKey);
    const wrappedShare2 = await cryptoUtils.wrappedKeyShare(differentKeyShare, wrapKey);
    expect(wrappedShare1).not.toBe(wrappedShare2);
  });

  test('different wrap keys produce different outputs', async () => {
    const differentWrapKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    const wrappedShare1 = await cryptoUtils.wrappedKeyShare(exampleKeyShare, wrapKey);
    const wrappedShare2 = await cryptoUtils.wrappedKeyShare(exampleKeyShare, differentWrapKey);
    expect(wrappedShare1).not.toBe(wrappedShare2);
  });
});
