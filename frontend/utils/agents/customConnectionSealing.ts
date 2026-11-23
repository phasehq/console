/**
 * Seals a custom Connection's secret in the browser, bound to its hosts. Nothing here
 * keeps a secret: callers pass values in and get ciphertext back.
 */

import { encryptAsymmetric, randomFormattedKeyPair } from '@/utils/crypto/general'
import {
  agentVisibleTexts,
  boundHosts,
  secretFieldNames,
  secretValueProblem,
  type HttpDefinition,
} from '@/utils/agents/httpDefinition'

export const SEALED_VALUE_VERSION = 1

/**
 * The exact plaintext that gets sealed: `{"v":1,"hosts":[…],"fields":{…}}`.
 * `hosts` binds host and port only. The proxy decodes it strictly.
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
  /** Plain HTTP was turned on: the stored value may now travel unencrypted. */
  plainHttpEnabled: boolean
  /** The Agent can read text the stored definition does not have. */
  textAdded: boolean
  /** Why the secret is asked for again; '' when it is not, or on a first entry. */
  reason: string
}

type RequirementShape = Pick<HttpDefinition, 'hosts' | 'fields' | 'allowPlainHttp'> &
  Partial<Pick<HttpDefinition, 'injections'>>

const PLAIN_HTTP_REASON =
  'Plain HTTP was turned on, so the secret may now be sent unencrypted. Enter the secret again to confirm it.'

const TEXT_REASON =
  'Text the Agent can read changed, such as an identifier, a prefix, a header name or a path. Enter the secret again so it can be checked against that text.'

/**
 * Whether a definition shows the Agent text the stored one does not: the stored secret was
 * only checked against the stored text. Mirrors `adds_agent_visible_text` on the backend.
 */
const addsAgentVisibleText = (current: RequirementShape, requested: RequirementShape) => {
  const texts = (shape: RequirementShape) =>
    agentVisibleTexts({ ...shape, injections: shape.injections ?? [] }).map(({ text }) => text)
  const known = new Set(texts(current))
  return texts(requested).some((text) => !known.has(text))
}

/**
 * Whether a definition change needs the secret entered again: when the bound hosts or the
 * secret field set change, plain HTTP is turned on, or the Agent can read new text.
 */
export const secretRequirement = (
  current: RequirementShape | null | undefined,
  requested: RequirementShape | null | undefined
): SecretRequirement => {
  const none = {
    required: false,
    hostsChanged: false,
    fieldsChanged: false,
    plainHttpEnabled: false,
    textAdded: false,
    reason: '',
  }
  if (!requested) return none
  if (!current) return { ...none, required: true }
  const hostsChanged =
    JSON.stringify(boundHosts(current.hosts)) !== JSON.stringify(boundHosts(requested.hosts))
  const before = secretFieldNames(current).sort()
  const after = secretFieldNames(requested).sort()
  const fieldsChanged = JSON.stringify(before) !== JSON.stringify(after)
  const plainHttpEnabled = requested.allowPlainHttp === true && current.allowPlainHttp !== true
  const textAdded = addsAgentVisibleText(current, requested)
  const rebound = hostsChanged
    ? fieldsChanged
      ? 'The allowed hosts and the set of secrets changed. The stored value is sealed to its hosts and holds exactly its secrets, so enter every secret again.'
      : 'The allowed hosts changed. The stored value is sealed to the hosts it may be sent to, so enter the secret again.'
    : fieldsChanged
      ? 'The set of secrets changed. The stored value holds exactly its secrets, so enter every secret again.'
      : ''
  const reason = [
    rebound,
    plainHttpEnabled ? PLAIN_HTTP_REASON : '',
    // A new host is new text too; its own reason already asks for the secret.
    textAdded && !rebound ? TEXT_REASON : '',
  ]
    .filter(Boolean)
    .join(' ')
  return {
    required: hostsChanged || fieldsChanged || plainHttpEnabled || textAdded,
    hostsChanged,
    fieldsChanged,
    plainHttpEnabled,
    textAdded,
    reason,
  }
}
