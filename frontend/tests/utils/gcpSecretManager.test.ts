import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  GCP_INTEGRATIONS,
  GCP_PREFIX_REGEX,
  GCP_PROJECT_ID_REGEX,
  GCP_PROJECT_NUMBER_REGEX,
  GCP_SECRET_ID_REGEX,
  GCP_SECRET_MANAGER,
  gcpKmsGrantScript,
  gcpProviderIdForKey,
  gcpSecretManagerLocations,
  gcpSetupScript,
  parseJwks,
  kmsKeyNameError,
  normalizeWorkloadIdentityProvider,
  parseWorkloadIdentityProvider,
  workloadIdentityProviderName,
} from '@/utils/syncing/gcp'

const PROVIDER =
  'projects/123456789012/locations/global/workloadIdentityPools/phase/providers/phase-3f9a1b2c'
const SUBJECT = 'phase:org:7b1e3f7a-2c1d-4a3b-9e8f-0123456789ab:key:3f9a1b2c'
const PRINCIPAL = `principal://iam.googleapis.com/projects/123456789012/locations/global/workloadIdentityPools/phase/subject/${SUBJECT}`

describe('workload identity provider names', () => {
  it.each([PROVIDER, `//iam.googleapis.com/${PROVIDER}`, `https://iam.googleapis.com/${PROVIDER}`])(
    'accepts %s',
    (value) => {
      expect(normalizeWorkloadIdentityProvider(value)).toBe(PROVIDER)
      expect(parseWorkloadIdentityProvider(value)).toEqual({
        projectNumber: '123456789012',
        poolId: 'phase',
        providerId: 'phase-3f9a1b2c',
      })
    }
  )

  it.each([
    '',
    'projects/my-project/locations/global/workloadIdentityPools/phase/providers/phase',
    'projects/123/locations/us-central1/workloadIdentityPools/phase/providers/phase',
    'projects/123/locations/global/workloadIdentityPools/phase',
  ])('rejects %p', (value) => {
    expect(parseWorkloadIdentityProvider(value)).toBeNull()
  })

  it('builds the provider name from the project number alone', () => {
    expect(workloadIdentityProviderName(' 123456789012 ', 'phase-3f9a1b2c')).toBe(PROVIDER)
    expect(
      parseWorkloadIdentityProvider(workloadIdentityProviderName('123456789012', 'phase-3f9a1b2c'))
    ).not.toBeNull()
  })

  it('derives a provider ID Google accepts', () => {
    const providerId = gcpProviderIdForKey('3f9a1b2c4d5e6f708192a3b4c5d6e7f8')
    expect(providerId).toBe('phase-3f9a1b2c')
    expect(providerId).toMatch(/^[a-z][a-z0-9-]{3,31}$/)
  })
})

describe('validation mirrors the backend', () => {
  it('secret names', () => {
    expect(GCP_SECRET_ID_REGEX.test('DATABASE_URL')).toBe(true)
    expect(GCP_SECRET_ID_REGEX.test('app-prod')).toBe(true)
    expect(GCP_SECRET_ID_REGEX.test('spring.datasource.url')).toBe(false)
    expect(GCP_SECRET_ID_REGEX.test('x'.repeat(256))).toBe(false)
  })

  it('prefixes', () => {
    expect(GCP_PREFIX_REGEX.test('')).toBe(true)
    expect(GCP_PREFIX_REGEX.test('PROD_')).toBe(true)
    expect(GCP_PREFIX_REGEX.test('PROD.')).toBe(false)
  })

  it('project numbers', () => {
    expect(GCP_PROJECT_NUMBER_REGEX.test('123456789012')).toBe(true)
    expect(GCP_PROJECT_NUMBER_REGEX.test('my-project')).toBe(false)
    expect(GCP_PROJECT_NUMBER_REGEX.test('12345')).toBe(false)
  })

  it('project IDs and numbers', () => {
    expect(GCP_PROJECT_ID_REGEX.test('my-project')).toBe(true)
    expect(GCP_PROJECT_ID_REGEX.test('123456789012')).toBe(true)
    expect(GCP_PROJECT_ID_REGEX.test('My-Project')).toBe(false)
    expect(GCP_PROJECT_ID_REGEX.test('short')).toBe(false)
  })

  it('CMEK key locations', () => {
    const globalKey = 'projects/kms/locations/global/keyRings/r/cryptoKeys/k'
    const regionalKey = 'projects/kms/locations/europe-west4/keyRings/r/cryptoKeys/k'
    expect(kmsKeyNameError('', 'global')).toBeNull()
    expect(kmsKeyNameError(globalKey, 'global')).toBeNull()
    expect(kmsKeyNameError(regionalKey, 'europe-west4')).toBeNull()
    expect(kmsKeyNameError(regionalKey, 'global')).toMatch(/'global' location/)
    expect(kmsKeyNameError(globalKey, 'europe-west4')).toMatch(/not a global key/)
    expect(kmsKeyNameError(regionalKey, 'us-central1')).toMatch(/not europe-west4/)
    // Multi-regions are left to Google.
    expect(
      kmsKeyNameError('projects/kms/locations/europe/keyRings/r/cryptoKeys/k', 'eu')
    ).toBeNull()
    expect(kmsKeyNameError('projects/kms/keyRings/r', 'global')).toMatch(/full key name/)
  })

  it('every listed location is a valid regional endpoint label', () => {
    for (const location of gcpSecretManagerLocations) {
      expect(location.id).toMatch(/^[a-z]{2,20}(?:-[a-z]{2,20}[0-9]{1,2})?$/)
    }
    expect(new Set(gcpSecretManagerLocations.map((l) => l.id)).size).toBe(
      gcpSecretManagerLocations.length
    )
  })
})

describe('integrations', () => {
  it('each has a tab name, the APIs it calls and the roles it grants', () => {
    expect(GCP_INTEGRATIONS).toContain(GCP_SECRET_MANAGER)
    expect(GCP_SECRET_MANAGER.apis).toEqual(['secretmanager.googleapis.com'])
    expect(GCP_SECRET_MANAGER.roles).toEqual([
      'roles/secretmanager.editor',
      'roles/secretmanager.secretAccessor',
    ])
  })
})

const JWKS = JSON.stringify(
  { keys: [{ kty: 'RSA', alg: 'RS256', use: 'sig', kid: 'abc', n: 'xyz', e: 'AQAB' }] },
  null,
  2
)

const setupScript = (overrides: Partial<Parameters<typeof gcpSetupScript>[0]> = {}) =>
  gcpSetupScript({
    projectNumber: '123456789012',
    providerId: 'phase-3f9a1b2c',
    issuer: 'https://console.phase.dev',
    subject: SUBJECT,
    jwks: JWKS,
    integration: GCP_SECRET_MANAGER,
    ...overrides,
  })

describe('setup script text', () => {
  const script = setupScript()

  it('runs in a subshell that stops at the first error', () => {
    const lines = script.trimEnd().split('\n')
    expect(lines[0]).toBe('(')
    expect(lines[1]).toBe('set -euo pipefail')
    expect(lines[lines.length - 1]).toBe(')')
  })

  it('assigns every value once, single-quoted', () => {
    expect(script).toContain(`PROJECT_NUMBER='123456789012'`)
    expect(script).toContain(`ISSUER='https://console.phase.dev'`)
    expect(script).toContain(`SUBJECT='${SUBJECT}'`)
    expect(script.split(SUBJECT).length - 1).toBe(1)
  })

  it('uploads the JWKS instead of pointing Google at Phase', () => {
    expect(script).toContain(`printf '%s\\n' '${JWKS}' > phase-jwks.json`)
    expect(script).toContain('--jwk-json-path=phase-jwks.json')
    expect(script).toContain('--issuer-uri="$ISSUER"')
    expect(script).toContain("# Phase's public key for this credential.\n")
    expect(script).not.toContain('Google never contacts Phase')
    // gcloud's Workload Identity commands only take the project ID.
    expect(script).toContain(
      `PROJECT_ID="$(gcloud projects describe "$PROJECT_NUMBER" --format='value(projectId)')"`
    )
  })

  it("grants the integration's roles to the credential's subject", () => {
    expect(script).toContain(
      'for ROLE in roles/secretmanager.editor roles/secretmanager.secretAccessor; do'
    )
    expect(script).toContain('--member="$PRINCIPAL"')
    expect(script).toContain('--attribute-condition="assertion.sub == \\"$SUBJECT\\""')
  })
})

/**
 * Runs a generated script under bash with gcloud replaced by a function that
 * records its arguments (one per line, calls separated by ---).
 */
const runScript = (script: string, env: Record<string, string> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'phase-gcp-script-'))
  const log = join(dir, 'gcloud.log')
  const stub = `gcloud() {
  printf '%s\\n' --- "$@" >> "$GCLOUD_LOG"
  case "$*" in
    *"value(projectNumber)"*) echo 123456789012 ;;
    *"projects describe"*) echo my-project ;;
    *"workload-identity-pools describe"*) [ -n "\${POOL_STATE:-}" ] && echo "$POOL_STATE" || return 1 ;;
    *"providers describe"*) [ -n "\${PROVIDER_STATE:-}" ] && echo "$PROVIDER_STATE" || return 1 ;;
    *"providers create-oidc"*) [ -z "\${FAIL_CREATE:-}" ] || return 1 ;;
  esac
}
`
  let stdout = ''
  let failed = false
  try {
    stdout = execFileSync('bash', ['-c', stub + script], {
      cwd: dir,
      env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', GCLOUD_LOG: log, ...env },
      encoding: 'utf8',
    })
  } catch {
    failed = true
  }
  const calls = existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('---\n')
        .filter(Boolean)
        .map((call) => call.trimEnd().split('\n'))
    : []
  const jwksPath = join(dir, 'phase-jwks.json')
  const result = {
    stdout,
    failed,
    calls,
    jwks: existsSync(jwksPath) ? readFileSync(jwksPath, 'utf8') : null,
    pwned: existsSync(join(dir, 'pwned')),
  }
  rmSync(dir, { recursive: true, force: true })
  return result
}

describe('setup script under bash', () => {
  it('creates the pool and provider and grants the roles', () => {
    const result = runScript(setupScript())

    expect(result.failed).toBe(false)
    expect(result.jwks).toBe(`${JWKS}\n`)
    const commands = result.calls.map((args) => args.slice(0, 4).join(' '))
    expect(result.calls[0]).toEqual([
      'services',
      'enable',
      'iam.googleapis.com',
      'sts.googleapis.com',
      'cloudresourcemanager.googleapis.com',
      'secretmanager.googleapis.com',
      '--project=123456789012',
    ])
    expect(result.calls[1]).toEqual([
      'projects',
      'describe',
      '123456789012',
      '--format=value(projectId)',
    ])
    // Everything after the lookup addresses the project by ID; gcloud's
    // Workload Identity commands reject a project number.
    for (const args of result.calls.slice(2)) {
      const project = args.find((a) => a.startsWith('--project=')) ?? args[2]
      expect(project).toMatch(/my-project$/)
    }
    expect(commands).toContain('iam workload-identity-pools create phase')
    expect(commands).toContain('iam workload-identity-pools providers create-oidc')
    const create = result.calls.find((args) => args.includes('create-oidc'))!
    expect(create).toContain('--issuer-uri=https://console.phase.dev')
    expect(create).toContain(`--attribute-condition=assertion.sub == "${SUBJECT}"`)
    const grants = result.calls.filter((args) => args[1] === 'add-iam-policy-binding')
    expect(grants.map((args) => args.find((a) => a.startsWith('--role=')))).toEqual([
      '--role=roles/secretmanager.editor',
      '--role=roles/secretmanager.secretAccessor',
    ])
    expect(grants[0]).toContain(`--member=${PRINCIPAL}`)
    expect(result.stdout.trim()).toBe('Done: Google Cloud now trusts this Phase integration.')
  })

  it('restores a deleted pool and provider and updates the provider in place', () => {
    const result = runScript(setupScript(), { POOL_STATE: 'DELETED', PROVIDER_STATE: 'DELETED' })

    expect(result.failed).toBe(false)
    const commands = result.calls.map((args) => args.slice(0, 4).join(' '))
    expect(commands).toContain('iam workload-identity-pools undelete phase')
    expect(commands).toContain('iam workload-identity-pools providers undelete')
    expect(commands).toContain('iam workload-identity-pools providers update-oidc')
    expect(commands).not.toContain('iam workload-identity-pools create phase')
  })

  it('updates an existing provider instead of failing', () => {
    const result = runScript(setupScript(), { POOL_STATE: 'ACTIVE', PROVIDER_STATE: 'ACTIVE' })

    expect(result.failed).toBe(false)
    const commands = result.calls.map((args) => args.slice(0, 4).join(' '))
    expect(commands).toContain('iam workload-identity-pools providers update-oidc')
    expect(commands).not.toContain('iam workload-identity-pools providers create-oidc')
  })

  it('stops at the first failure', () => {
    const result = runScript(setupScript(), { FAIL_CREATE: '1' })

    expect(result.failed).toBe(true)
    expect(result.calls.some((args) => args[1] === 'add-iam-policy-binding')).toBe(false)
  })

  it('runs hostile values as data, never as commands', () => {
    const subject = `x" ; touch pwned ; echo "$(touch pwned)\`touch pwned\`'`
    const jwks = `{"a":1}\nEOF\ntouch pwned\n$(touch pwned)`
    const result = runScript(
      setupScript({
        projectNumber: `p'$(touch pwned)`,
        issuer: 'https://x/$(touch pwned)',
        subject,
        jwks,
      })
    )

    expect(result.failed).toBe(false)
    expect(result.pwned).toBe(false)
    expect(result.jwks).toBe(`${jwks}\n`)
    const create = result.calls.find((args) => args.includes('create-oidc'))!
    expect(create).toContain(`--attribute-condition=assertion.sub == "${subject}"`)
    expect(create).toContain('--issuer-uri=https://x/$(touch pwned)')
    const grant = result.calls.find((args) => args[1] === 'add-iam-policy-binding')!
    expect(grant).toContain(
      `--member=principal://iam.googleapis.com/projects/p'$(touch pwned)/locations/global/workloadIdentityPools/phase/subject/${subject}`
    )
  })
})

describe('CMEK grant script under bash', () => {
  const KMS_KEY = 'projects/kms-project/locations/global/keyRings/ring/cryptoKeys/key'

  it("lets the project's Secret Manager service agent use the key", () => {
    const result = runScript(gcpKmsGrantScript({ project: 'my-project', kmsKeyName: KMS_KEY }))

    expect(result.failed).toBe(false)
    expect(result.calls).toEqual([
      [
        'beta',
        'services',
        'identity',
        'create',
        '--service=secretmanager.googleapis.com',
        '--project=my-project',
      ],
      ['projects', 'describe', 'my-project', '--format=value(projectNumber)'],
      [
        'kms',
        'keys',
        'add-iam-policy-binding',
        KMS_KEY,
        '--member=serviceAccount:service-123456789012@gcp-sa-secretmanager.iam.gserviceaccount.com',
        '--role=roles/cloudkms.cryptoKeyEncrypterDecrypter',
        '--condition=None',
      ],
    ])
    expect(result.stdout.trim()).toBe('Done: Secret Manager can now encrypt with this key.')
  })

  it('runs hostile values as data, never as commands', () => {
    const kmsKeyName = `k"; touch pwned; "$(touch pwned)`
    const result = runScript(gcpKmsGrantScript({ project: `p'$(touch pwned)`, kmsKeyName }))

    expect(result.failed).toBe(false)
    expect(result.pwned).toBe(false)
    expect(result.calls[2][3]).toBe(kmsKeyName)
  })
})

describe('parseJwks', () => {
  // A real 2048-bit modulus is 342 base64url characters (256 bytes).
  const modulus = 'A'.repeat(342)
  const jwks = JSON.stringify({
    keys: [{ kty: 'RSA', alg: 'RS256', use: 'sig', kid: 'abc123', n: modulus, e: 'AQAB' }],
  })

  it('reads each key for display', () => {
    expect(parseJwks(jwks)).toEqual([
      {
        keyId: 'abc123',
        algorithm: 'RS256',
        keyType: 'RSA',
        use: 'sig',
        bits: 2048,
        exponent: 65537,
        modulus,
      },
    ])
  })

  it('returns null for anything it cannot read', () => {
    expect(parseJwks('not json')).toBeNull()
    expect(parseJwks('{}')).toBeNull()
    expect(parseJwks('{"keys":[]}')).toBeNull()
  })

  it('leaves out sizes it cannot decode', () => {
    const [key] = parseJwks(JSON.stringify({ keys: [{ kty: 'RSA', kid: 'k' }] }))!
    expect(key.bits).toBeNull()
    expect(key.exponent).toBeNull()
  })
})
