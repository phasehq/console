// Brand and acronym spellings for words in enum-like values, e.g. aws_assume_role.
const AGENT_WORD_SPELLINGS: Record<string, string> = {
  api: 'API',
  aws: 'AWS',
  gcp: 'GCP',
  github: 'GitHub',
  gitlab: 'GitLab',
  http: 'HTTP',
  https: 'HTTPS',
  iam: 'IAM',
  id: 'ID',
  kms: 'KMS',
  pg: 'PostgreSQL',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  s3: 'S3',
  sigv4: 'SigV4',
  sts: 'STS',
}

/** Title-case one lowercase word, keeping brand and acronym spellings. */
export const agentWordLabel = (word: string) =>
  AGENT_WORD_SPELLINGS[word] ?? `${word.charAt(0).toUpperCase()}${word.slice(1)}`

/** Canonicalize enum-like strings returned through GraphQL String fields. */
export const normalizeAgentEnum = (value?: string | null) => value?.trim().toUpperCase() || ''

export const isAgentActive = (status?: string | null) => normalizeAgentEnum(status) === 'ACTIVE'

export const isAgentRequestPending = (status?: string | null) =>
  normalizeAgentEnum(status) === 'PENDING'
