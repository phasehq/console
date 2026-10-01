/**
 * @jest-environment node
 */

import _sodium from 'libsodium-wrappers-sumo'

jest.mock('@/apollo/client', () => ({ graphQlClient: {} }))
jest.mock('@/graphql/queries/service-accounts/getServiceAccounts.gql', () => ({}))
jest.mock('@/graphql/queries/service-accounts/getServiceAccountHandlers.gql', () => ({}))
jest.mock('@/graphql/mutations/service-accounts/updateHandlerKeys.gql', () => ({}))
jest.mock('@/graphql/queries/syncing/getServerKey.gql', () => ({}))

import { generateSAToken, signSATokenMaterial } from '@/utils/crypto/service-accounts'
import { getUserKxPublicKey } from '@/utils/crypto'

const newSigningKeyring = async () => {
  await _sodium.ready
  const keyPair = _sodium.crypto_sign_keypair()
  return {
    publicKey: _sodium.to_hex(keyPair.publicKey),
    privateKey: _sodium.to_hex(keyPair.privateKey),
  }
}

const verifies = async (
  signatureHex: string,
  material: { token: string; identityKey: string; wrappedKeyShare: string },
  publicKeyHex: string
) => {
  await _sodium.ready
  const message = `${material.token}:${material.identityKey}:${material.wrappedKeyShare}`
  return _sodium.crypto_sign_verify_detached(
    _sodium.from_hex(signatureHex),
    _sodium.from_string(message),
    _sodium.from_hex(publicKeyHex)
  )
}

describe('signSATokenMaterial', () => {
  const material = {
    token: 'ab'.repeat(32),
    identityKey: 'cd'.repeat(32),
    wrappedKeyShare: 'ef'.repeat(56),
  }

  test('produces a detached signature the SA public key verifies', async () => {
    const keyring = await newSigningKeyring()

    const signature = await signSATokenMaterial(material, keyring.privateKey)

    expect(signature).toMatch(/^[a-f0-9]{128}$/)
    expect(await verifies(signature, material, keyring.publicKey)).toBe(true)
  })

  test('signature does not verify for tampered material or another key', async () => {
    const keyring = await newSigningKeyring()
    const otherKeyring = await newSigningKeyring()

    const signature = await signSATokenMaterial(material, keyring.privateKey)

    expect(
      await verifies(signature, { ...material, token: 'ff'.repeat(32) }, keyring.publicKey)
    ).toBe(false)
    expect(await verifies(signature, material, otherKeyring.publicKey)).toBe(false)
  })
})

describe('generateSAToken', () => {
  test('binds the payload to the SA kx identity key and signs it with the SA signing key', async () => {
    const keyring = await newSigningKeyring()

    const { pssService, mutationPayload } = await generateSAToken('sa-1', keyring, 'deploy', null)

    const expectedIdentityKey = await getUserKxPublicKey(keyring.publicKey)
    expect(mutationPayload.identityKey).toBe(expectedIdentityKey)
    expect(mutationPayload.serviceAccountId).toBe('sa-1')
    expect(mutationPayload.name).toBe('deploy')
    expect(mutationPayload.expiry).toBeNull()
    expect(pssService.split(':')[3]).toBe(expectedIdentityKey)
    expect(pssService.split(':')[2]).toBe(mutationPayload.token)
    expect(await verifies(mutationPayload.signature, mutationPayload, keyring.publicKey)).toBe(true)
  })
})
