/**
 * Sealing a custom Connection's secret in the browser.
 *
 * The value is stored once, sealed to the Connection's own public key, and
 * bound to the hosts it may be sent to. Nothing here logs or keeps a secret:
 * callers pass the values in and get ciphertext back.
 */

import { encryptAsymmetric, randomFormattedKeyPair } from '@/utils/crypto/general'
import {
  boundHosts,
  secretFieldNames,
  secretValueProblem,
  type HttpDefinition,
} from '@/utils/agents/httpDefinition'

export const SEALED_VALUE_VERSION = 1

/**
 * The exact plaintext that gets sealed: `{"v":1,"hosts":[…],"fields":{…}}`.
 *
 * `hosts` is the definition's host list reduced to match, value and port,
 * deduplicated and sorted; paths are not bound. `fields` holds exactly the
 * definition's secret fields. The proxy decodes this strictly, so it carries
 * no other member.
 */
export const sealedValuePlaintext = (
  definition: Pick<HttpDefinition, 'hosts' | 'fields'>,
  secrets: Record<string, string>
): string => {
  const names = secretFieldNames(definition)
  const unknown = Object.keys(secrets).filter((name) => !names.includes(name))
  if (unknown.length > 0) throw new Error('A secret was entered for a field that does not exist.')
  const fields: Record<string, string> = {}
  for (const name of names) {
    const value = secrets[name]
    if (typeof value !== 'string' || value === '') throw new Error(`Enter the secret for ${name}.`)
    fields[name] = value
  }
  return JSON.stringify({
    v: SEALED_VALUE_VERSION,
    hosts: boundHosts(definition.hosts).map((rule) =>
      rule.port === undefined
        ? { match: rule.match, value: rule.value }
        : { match: rule.match, value: rule.value, port: rule.port }
    ),
    fields,
  })
}

/** The first reason any entered secret would be refused, or ''. */
export const secretsProblem = (
  definition: HttpDefinition,
  secrets: Record<string, string>
): string => {
  for (const name of secretFieldNames(definition)) {
    const value = secrets[name]
    if (!value) return `Enter the secret for ${name}.`
    const problem = secretValueProblem(value, definition)
    if (problem) return problem
  }
  return ''
}

/** Seal new secret values to an existing Connection's public key. */
export const sealCustomConnectionValue = async (
  definition: HttpDefinition,
  secrets: Record<string, string>,
  encryptionPublicKey: string
): Promise<string> => {
  if (!/^[0-9a-f]{64}$/.test(encryptionPublicKey))
    throw new Error('This Connection has no encryption key. Reload and try again.')
  return encryptAsymmetric(sealedValuePlaintext(definition, secrets), encryptionPublicKey)
}

export type NewConnectionMaterial = {
  encryptionPublicKey: string
  sealedValue: string
  serverWrappedKey: string
}

/**
 * Everything a new custom Connection needs: a fresh keypair, the value sealed
 * to it, and the private key wrapped to the server.
 */
export const newCustomConnectionMaterial = async (
  definition: HttpDefinition,
  secrets: Record<string, string>,
  serverPublicKey: string
): Promise<NewConnectionMaterial> => {
  if (!serverPublicKey) throw new Error('The server key is not available yet. Try again.')
  const plaintext = sealedValuePlaintext(definition, secrets)
  const keyPair = await randomFormattedKeyPair('hex')
  return {
    encryptionPublicKey: keyPair.publicKey,
    sealedValue: await encryptAsymmetric(plaintext, keyPair.publicKey),
    serverWrappedKey: await encryptAsymmetric(keyPair.privateKey, serverPublicKey),
  }
}

export type SecretRequirement = {
  required: boolean
  hostsChanged: boolean
  fieldsChanged: boolean
  /** Why the secret is asked for again; '' when it is not, or on a first entry. */
  reason: string
}

/**
 * Whether a change to a definition needs the secret entered again. It does
 * when the bound hosts (match, value, port) or the set of secret fields
 * change; paths, injections, names and environment names do not.
 */
export const secretRequirement = (
  current: Pick<HttpDefinition, 'hosts' | 'fields'> | null | undefined,
  requested: Pick<HttpDefinition, 'hosts' | 'fields'> | null | undefined
): SecretRequirement => {
  if (!requested) return { required: false, hostsChanged: false, fieldsChanged: false, reason: '' }
  if (!current) return { required: true, hostsChanged: false, fieldsChanged: false, reason: '' }
  const hostsChanged =
    JSON.stringify(boundHosts(current.hosts)) !== JSON.stringify(boundHosts(requested.hosts))
  const before = secretFieldNames(current).sort()
  const after = secretFieldNames(requested).sort()
  const fieldsChanged = JSON.stringify(before) !== JSON.stringify(after)
  const reason = hostsChanged
    ? fieldsChanged
      ? 'The allowed hosts and the set of secrets changed. The stored value is sealed to its hosts and holds exactly its secrets, so enter every secret again.'
      : 'The allowed hosts changed. The stored value is sealed to the hosts it may be sent to, so enter the secret again.'
    : fieldsChanged
      ? 'The set of secrets changed. The stored value holds exactly its secrets, so enter every secret again.'
      : ''
  return { required: hostsChanged || fieldsChanged, hostsChanged, fieldsChanged, reason }
}
