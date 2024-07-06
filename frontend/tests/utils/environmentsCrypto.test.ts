import {
  newEnvSeed,
  newEnvSalt,
  newEnvToken,
  newEnvWrapKey,
  encryptedEnvSeed,
  envKeyring,
  newServiceTokenKeys,
  decryptAppSeed,
} from '@/utils/crypto'

describe('New Environment Key Generation Tests', () => {
  const expectedHexLength = 64

  test('newEnvSeed returns hex string of correct length', async () => {
    const seed = await newEnvSeed()
    expect(seed).toMatch(/^[a-f0-9]{64}$/)
    expect(seed.length).toBe(expectedHexLength)
  })

  test('newEnvSeed produces unique seeds', async () => {
    const seed1 = await newEnvSeed()
    const seed2 = await newEnvSeed()
    expect(seed1).not.toBe(seed2)
  })

  test('newEnvSalt returns hex string of correct length', async () => {
    const salt = await newEnvSalt()
    expect(salt).toMatch(/^[a-f0-9]{64}$/)
    expect(salt.length).toBe(expectedHexLength)
  })

  test('newEnvSalt produces unique salts', async () => {
    const salt1 = await newEnvSalt()
    const salt2 = await newEnvSalt()
    expect(salt1).not.toBe(salt2)
  })

  test('newEnvToken returns hex string of correct length', async () => {
    const token = await newEnvToken()
    expect(token).toMatch(/^[a-f0-9]{64}$/)
    expect(token.length).toBe(expectedHexLength)
  })

  test('newEnvToken produces unique tokens', async () => {
    const token1 = await newEnvToken()
    const token2 = await newEnvToken()
    expect(token1).not.toBe(token2)
  })

  test('newEnvWrapKey returns hex string of correct length', async () => {
    const key = await newEnvWrapKey()
    expect(key).toMatch(/^[a-f0-9]{64}$/)
    expect(key.length).toBe(expectedHexLength)
  })

  test('newEnvWrapKey produces unique keys', async () => {
    const key1 = await newEnvWrapKey()
    const key2 = await newEnvWrapKey()
    expect(key1).not.toBe(key2)
  })
})

describe('Environment Seed Encryption and Decryption Tests', () => {
  let exampleSeed: string
  const encryptionKey = 'fe5c08da8d3c54a991a419756646164732506508b2d84e469df05f27689ee7a5'

  beforeAll(async () => {
    exampleSeed = await newEnvSeed()
  })

  test('encryptedEnvSeed returns hex encoded string', async () => {
    const encryptedSeed = await encryptedEnvSeed(exampleSeed, encryptionKey)
    expect(encryptedSeed).toMatch(/^[a-f0-9]+$/)
  })

  test('decryptedAppSeed retrieves original seed', async () => {
    const encryptedSeed = await encryptedEnvSeed(exampleSeed, encryptionKey)
    const decryptedSeed = await decryptAppSeed(encryptedSeed, encryptionKey)
    expect(decryptedSeed).toBe(exampleSeed)
  })

  test('decryptedAppSeed with incorrect key fails', async () => {
    const encryptedSeed = await encryptedEnvSeed(exampleSeed, encryptionKey)
    const wrongKey = 'f1e2d3c4b5a697887766554433221100ffeeddccbbaa99887766554433221100'

    await expect(decryptAppSeed(encryptedSeed, wrongKey)).rejects.toThrow()
  })

  test('decryptedAppSeed with incorrect encrypted seed fails', async () => {
    const incorrectEncryptedSeed = 'abcdef'

    await expect(decryptAppSeed(incorrectEncryptedSeed, encryptionKey)).rejects.toThrow()
  })
})

describe('Environment and Service Token Keyring Tests', () => {
  test('envKeyring produces consistent key pair for same seed', async () => {
    const envSeed = await newEnvSeed()
    const keyring1 = await envKeyring(envSeed)
    const keyring2 = await envKeyring(envSeed)
    expect(keyring1).toEqual(keyring2)
  })

  test('envKeyring key pair is in hex format and of correct lengths', async () => {
    const envSeed = await newEnvSeed()
    const keyring = await envKeyring(envSeed)
    expect(keyring.publicKey).toMatch(/^[a-f0-9]+$/)
    expect(keyring.privateKey).toMatch(/^[a-f0-9]+$/)
  })

  test('newServiceTokenKeys produces unique key pairs', async () => {
    const tokenKeys1 = await newServiceTokenKeys()
    const tokenKeys2 = await newServiceTokenKeys()
    expect(tokenKeys1).not.toEqual(tokenKeys2)
  })

  test('newServiceTokenKeys key pair is in hex format and of correct lengths', async () => {
    const tokenKeys = await newServiceTokenKeys()
    expect(tokenKeys.publicKey).toMatch(/^[a-f0-9]+$/)
    expect(tokenKeys.privateKey).toMatch(/^[a-f0-9]+$/)
  })
})
