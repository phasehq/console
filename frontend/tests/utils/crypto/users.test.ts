import { decryptAccountKeyring, decryptAccountRecovery, deviceVaultKey, encryptAccountKeyring, encryptAccountRecovery, getWrappedKeyShare, organisationKeyring, organisationSeed } from "@/utils/crypto"

describe('Organisation Seed Generation Tests', () => {
  test('organisationSeed produces consistent output for same inputs', async () => {
    const mnemonic =
      'junk eagle stock health body hurry unfold square rather edit sword infant glide alcohol october hope wink tent mask hedgehog purity lonely note concert'
    const orgId = 'e1c22c4f-62f6-4f7e-9faa-cbf8653ab976'

    const seed1 = await organisationSeed(mnemonic, orgId)
    const seed2 = await organisationSeed(mnemonic, orgId)
    expect(seed1).toEqual(seed2)
  })

  test('organisationSeed output is 32 bytes', async () => {
    const mnemonic =
      'provide love harvest easily saddle annual element engage october donate box devote upon simple cruise wage normal wine crisp health average reason uphold copper'
    const orgId = 'e7a561f0-01b2-4430-b99f-0f2a3bdb11cb'

    const seed = await organisationSeed(mnemonic, orgId)
    expect(seed.length).toBe(32)
  })

  test('organisationSeed produces different outputs for different inputs', async () => {
    const mnemonic1 =
      'recall seed gorilla accuse fade blade fever legend scan load token educate upgrade fragile keen peanut panther suit sword net armed staff torch holiday'
    const mnemonic2 =
      'walnut impulse repair pool vanish goddess own gesture wine galaxy vicious attract scissors stem talk orient pause maple cage talk trick gap jeans payment'
    const orgId = '34e26348-a5be-4f01-80aa-902ee8564354'

    const seed1 = await organisationSeed(mnemonic1, orgId)
    const seed2 = await organisationSeed(mnemonic2, orgId)
    expect(seed1).not.toEqual(seed2)
  })

  test('organisationSeed is case sensitive', async () => {
    const mnemonic =
      'recall seed gorilla accuse fade blade fever legend scan load token educate upgrade fragile keen peanut panther suit sword net armed staff torch holiday'
    const orgId = 'a4f57f35-2310-4448-8180-c39c5a45f3a1'

    const seed1 = await organisationSeed(mnemonic, orgId)
    const seed2 = await organisationSeed(mnemonic.toUpperCase(), orgId)
    expect(seed1).not.toEqual(seed2)
  })
})

describe('Organisation Keyring Tests', () => {
  const seed = new Uint8Array(32).fill(1) // Example seed

  test('organisationKeyring produces consistent keys for same seed', async () => {
    const keyring1 = await organisationKeyring(seed)
    const keyring2 = await organisationKeyring(seed)
    expect(keyring1).toEqual(keyring2)
  })

  test('keys are of correct lengths', async () => {
    const keyring = await organisationKeyring(seed)
    expect(keyring.symmetricKey.length).toBe(64) // Length in hex representation
    expect(keyring.privateKey.length).toBeGreaterThan(64)
    expect(keyring.publicKey.length).toBeGreaterThan(32)
  })

  test('different seeds produce different keys', async () => {
    const differentSeed = new Uint8Array(32).fill(2)
    const keyring1 = await organisationKeyring(seed)
    const keyring2 = await organisationKeyring(differentSeed)
    expect(keyring1).not.toEqual(keyring2)
  })

  test('symmetric key and signing keys are derived independently', async () => {
    const keyring = await organisationKeyring(seed)
    expect(keyring.symmetricKey).not.toBe(keyring.privateKey)
    expect(keyring.symmetricKey).not.toBe(keyring.publicKey)
  })

  test('keys adhere to respective formats', async () => {
    const keyring = await organisationKeyring(seed)
    expect(keyring.symmetricKey).toMatch(/^[a-f0-9]{64}$/)
    expect(keyring.privateKey).toMatch(/^[a-f0-9]+$/)
    expect(keyring.publicKey).toMatch(/^[a-f0-9]+$/)
  })
})

describe('Device Vault Key Tests', () => {
  const password = 'correct-horse-staple-battery'
  const email = 'satoshi@gmx.com'

  test('deviceVaultKey produces consistent key for same inputs', async () => {
    const key1 = await deviceVaultKey(password, email)
    const key2 = await deviceVaultKey(password, email)
    expect(key1).toBe(key2)
  })

  test('deviceVaultKey output is hex string of correct length', async () => {
    const key = await deviceVaultKey(password, email)
    expect(key).toMatch(/^[a-f0-9]{64}$/) // 32 Byte Hex string - 64 characters
  })

  test('different passwords produce different keys', async () => {
    const differentPassword = 'incorrect-horse-staple-battery'
    const key1 = await deviceVaultKey(password, email)
    const key2 = await deviceVaultKey(differentPassword, email)
    expect(key1).not.toBe(key2)
  })

  test('different emails produce different keys', async () => {
    const differentEmail = 'nakamoto@gmx.com'
    const key1 = await deviceVaultKey(password, email)
    const key2 = await deviceVaultKey(password, differentEmail)
    expect(key1).not.toBe(key2)
  })

  test('small changes in input produce significantly different keys', async () => {
    const key1 = await deviceVaultKey(password, email)
    const key2 = await deviceVaultKey(password + 'a', email)
    const key3 = await deviceVaultKey(password, email + 'a')
    expect(key1).not.toBe(key2)
    expect(key1).not.toBe(key3)
  })
})

describe('Account Keyring Encryption and Decryption Tests', () => {
  const exampleKeyring = {
    symmetricKey: 'a1b2c3d4e5f6g7h8i9j0',
    privateKey: 'privatekeyexample',
    publicKey: 'publickeyexample',
  }

  const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' // 64-character hex string

  test('encryptAccountKeyring returns hex encoded string', async () => {
    const encryptedKeyring = await encryptAccountKeyring(exampleKeyring, encryptionKey)
    expect(encryptedKeyring).toMatch(/^[a-f0-9]+$/)
  })

  test('decryptAccountKeyring retrieves original keyring', async () => {
    const encryptedKeyring = await encryptAccountKeyring(exampleKeyring, encryptionKey)
    const decryptedKeyring = await decryptAccountKeyring(encryptedKeyring, encryptionKey)
    expect(decryptedKeyring).toEqual(exampleKeyring)
  })

  test('decryptAccountKeyring with incorrect key fails', async () => {
    const encryptedKeyring = await encryptAccountKeyring(exampleKeyring, encryptionKey)
    const wrongKey = 'f1e2d3c4b5a697887766554433221100ffeeddccbbaa99887766554433221100'

    await expect(decryptAccountKeyring(encryptedKeyring, wrongKey)).rejects.toThrow()
  })

  test('decryptAccountKeyring with incorrect encrypted keyring fails', async () => {
    const incorrectEncryptedKeyring = 'abcdef'

    await expect(decryptAccountKeyring(incorrectEncryptedKeyring, encryptionKey)).rejects.toThrow()
  })
})

describe('Account Recovery Encryption and Decryption Tests', () => {
  const exampleMnemonic = 'test mnemonic phrase for encryption'
  const encryptionKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' // 64-character hex string

  test('encryptAccountRecovery returns hex encoded string', async () => {
    const encryptedRecovery = await encryptAccountRecovery(exampleMnemonic, encryptionKey)
    expect(encryptedRecovery).toMatch(/^[a-f0-9]+$/)
  })

  test('decryptAccountRecovery retrieves original mnemonic', async () => {
    const encryptedRecovery = await encryptAccountRecovery(exampleMnemonic, encryptionKey)
    const decryptedRecovery = await decryptAccountRecovery(encryptedRecovery, encryptionKey)
    expect(decryptedRecovery).toBe(exampleMnemonic)
  })

  test('decryptAccountRecovery with incorrect key fails', async () => {
    const encryptedRecovery = await encryptAccountRecovery(exampleMnemonic, encryptionKey)
    const wrongKey = 'f1e2d3c4b5a697887766554433221100ffeeddccbbaa99887766554433221100'

    await expect(decryptAccountRecovery(encryptedRecovery, wrongKey)).rejects.toThrow()
  })

  test('decryptAccountRecovery with incorrect encrypted mnemonic fails', async () => {
    const incorrectEncryptedRecovery = 'abcdef'

    await expect(
      decryptAccountRecovery(incorrectEncryptedRecovery, encryptionKey)
    ).rejects.toThrow()
  })
})

describe('Wrapped Key Share Tests', () => {
  const exampleKeyShare = 'examplekeysharedata'
  const wrapKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' // Example wrap key, 64-character hex string

  test('getWrappedKeyShare returns hex encoded string', async () => {
    const wrappedShare = await getWrappedKeyShare(exampleKeyShare, wrapKey)
    expect(wrappedShare).toMatch(/^[a-f0-9]+$/)
  })

  test('getWrappedKeyShare produces unique output for same input', async () => {
    const wrappedShare1 = await getWrappedKeyShare(exampleKeyShare, wrapKey)
    const wrappedShare2 = await getWrappedKeyShare(exampleKeyShare, wrapKey)
    expect(wrappedShare1).not.toBe(wrappedShare2) // Different due to random nonce
  })

  test('different key shares produce different outputs', async () => {
    const differentKeyShare = 'differentkeysharedata'
    const wrappedShare1 = await getWrappedKeyShare(exampleKeyShare, wrapKey)
    const wrappedShare2 = await getWrappedKeyShare(differentKeyShare, wrapKey)
    expect(wrappedShare1).not.toBe(wrappedShare2)
  })

  test('different wrap keys produce different outputs', async () => {
    const differentWrapKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'
    const wrappedShare1 = await getWrappedKeyShare(exampleKeyShare, wrapKey)
    const wrappedShare2 = await getWrappedKeyShare(exampleKeyShare, differentWrapKey)
    expect(wrappedShare1).not.toBe(wrappedShare2)
  })
})
