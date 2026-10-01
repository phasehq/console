export const GCP_GLOBAL_LOCATION = 'global'

export type GcpLocation = { id: string; name: string }

// Locations with a regional Secret Manager endpoint. The backend accepts any
// well-formed region, so this list only drives the picker.
export const gcpSecretManagerLocations: GcpLocation[] = [
  { id: 'us', name: 'United States (multi-region)' },
  { id: 'eu', name: 'European Union (multi-region)' },
  { id: 'ca', name: 'Canada (multi-region)' },
  { id: 'in', name: 'India (multi-region)' },
  { id: 'us-central1', name: 'Iowa' },
  { id: 'us-east1', name: 'South Carolina' },
  { id: 'us-east4', name: 'Northern Virginia' },
  { id: 'us-east5', name: 'Columbus' },
  { id: 'us-south1', name: 'Dallas' },
  { id: 'us-west1', name: 'Oregon' },
  { id: 'us-west2', name: 'Los Angeles' },
  { id: 'us-west3', name: 'Salt Lake City' },
  { id: 'us-west4', name: 'Las Vegas' },
  { id: 'northamerica-northeast1', name: 'Montréal' },
  { id: 'northamerica-northeast2', name: 'Toronto' },
  { id: 'northamerica-south1', name: 'Mexico' },
  { id: 'southamerica-east1', name: 'São Paulo' },
  { id: 'southamerica-west1', name: 'Santiago' },
  { id: 'europe-central2', name: 'Warsaw' },
  { id: 'europe-north2', name: 'Stockholm' },
  { id: 'europe-southwest1', name: 'Madrid' },
  { id: 'europe-west1', name: 'Belgium' },
  { id: 'europe-west2', name: 'London' },
  { id: 'europe-west3', name: 'Frankfurt' },
  { id: 'europe-west4', name: 'Netherlands' },
  { id: 'europe-west6', name: 'Zurich' },
  { id: 'europe-west8', name: 'Milan' },
  { id: 'europe-west9', name: 'Paris' },
  { id: 'europe-west10', name: 'Berlin' },
  { id: 'europe-west12', name: 'Turin' },
  { id: 'me-central1', name: 'Doha' },
  { id: 'me-central2', name: 'Dammam' },
  { id: 'me-west1', name: 'Tel Aviv' },
  { id: 'africa-south1', name: 'Johannesburg' },
  { id: 'asia-east1', name: 'Taiwan' },
  { id: 'asia-east2', name: 'Hong Kong' },
  { id: 'asia-northeast1', name: 'Tokyo' },
  { id: 'asia-northeast2', name: 'Osaka' },
  { id: 'asia-northeast3', name: 'Seoul' },
  { id: 'asia-south1', name: 'Mumbai' },
  { id: 'asia-south2', name: 'Delhi' },
  { id: 'asia-southeast1', name: 'Singapore' },
  { id: 'asia-southeast2', name: 'Jakarta' },
  { id: 'asia-southeast3', name: 'Bangkok' },
  { id: 'australia-southeast1', name: 'Sydney' },
  { id: 'australia-southeast2', name: 'Melbourne' },
]

// Mirrors of the backend's validation in api/utils/syncing/gcp.
export const GCP_SECRET_ID_REGEX = /^[A-Za-z0-9_-]{1,255}$/
export const GCP_PREFIX_REGEX = /^[A-Za-z0-9_-]{0,64}$/
export const GCP_PROJECT_ID_REGEX = /^(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|\d{1,20})$/
export const GCP_PROJECT_NUMBER_REGEX = /^\d{6,20}$/

/** Google's project selector: lists the projects you can access, and each
 * project's dashboard shows its number and ID. */
export const GCP_PROJECT_SELECTOR_URL =
  'https://console.cloud.google.com/projectselector2/home/dashboard'
const GCP_KMS_KEY_REGEX =
  /^projects\/[a-z0-9.:-]{1,63}\/locations\/([a-z0-9-]{1,63})\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}$/
const WORKLOAD_IDENTITY_PROVIDER_REGEX =
  /^projects\/(\d{1,20})\/locations\/global\/workloadIdentityPools\/([a-z0-9-]{4,32})\/providers\/([a-z0-9-]{4,32})$/

export const GCP_POOL_ID = 'phase'

/** Phase features that authenticate with a Google Cloud credential, with the
 * APIs they call and the roles they need on the credential's principal. The
 * setup UI shows a tab per entry, so a new feature (dynamic secrets,
 * rotation) is one more entry. */
export type GcpIntegration = { id: string; name: string; apis: string[]; roles: string[] }

export const GCP_SECRET_MANAGER: GcpIntegration = {
  id: 'gcp_secret_manager',
  name: 'GCP Secret Manager',
  apis: ['secretmanager.googleapis.com'],
  roles: ['roles/secretmanager.editor', 'roles/secretmanager.secretAccessor'],
}

export const GCP_INTEGRATIONS: GcpIntegration[] = [GCP_SECRET_MANAGER]

/** Accepts the bare resource name or the //iam.googleapis.com/ and
 * https://iam.googleapis.com/ audience forms. */
export const normalizeWorkloadIdentityProvider = (value: string) => {
  let name = value.trim()
  for (const prefix of ['https://iam.googleapis.com/', '//iam.googleapis.com/']) {
    if (name.startsWith(prefix)) name = name.slice(prefix.length)
  }
  return name
}

export const parseWorkloadIdentityProvider = (value: string) => {
  const match = WORKLOAD_IDENTITY_PROVIDER_REGEX.exec(normalizeWorkloadIdentityProvider(value))
  return match ? { projectNumber: match[1], poolId: match[2], providerId: match[3] } : null
}

/** The provider ID for a new credential: unique per signing key, so several
 * Phase credentials can share one pool. */
export const gcpProviderIdForKey = (keyId: string) => `phase-${keyId.slice(0, 8)}`

/** The provider's resource name. Phase picks the pool and provider IDs, so
 * the project number is the only part it needs from the user. */
export const workloadIdentityProviderName = (
  projectNumber: string,
  providerId: string,
  poolId: string = GCP_POOL_ID
) =>
  `projects/${projectNumber.trim()}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`

export const kmsKeyNameError = (value: string, location: string): string | null => {
  if (!value) return null
  const match = GCP_KMS_KEY_REGEX.exec(value)
  if (!match) return 'Enter the full key name: projects/…/locations/…/keyRings/…/cryptoKeys/…'
  const keyLocation = match[1]
  if (location === GCP_GLOBAL_LOCATION && keyLocation !== GCP_GLOBAL_LOCATION)
    return "Global secrets need a key in the 'global' location."
  if (location !== GCP_GLOBAL_LOCATION && keyLocation === GCP_GLOBAL_LOCATION)
    return `Regional secrets need a key in ${location}, not a global key.`
  // A single region needs a key in exactly that region; multi-regions are
  // left to Google to check.
  if (location.includes('-') && keyLocation !== location)
    return `Secrets in ${location} need a key in ${location}, not ${keyLocation}.`
  return null
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

const enableApisCommand = (projectVariable: string, integration: GcpIntegration, base: string[]) =>
  `gcloud services enable ${[...base, ...integration.apis].join(' ')} \\
  --project="$${projectVariable}"`

const grantRolesCommands = (projectVariable: string, integration: GcpIntegration) =>
  `for ROLE in ${integration.roles.join(' ')}; do
  gcloud projects add-iam-policy-binding "$${projectVariable}" --role="$ROLE" \\
    --member="$PRINCIPAL" --condition=None >/dev/null
done`

/**
 * A script for Cloud Shell that makes Google Cloud trust this credential's
 * key and grants its principal what `integration` needs in one project. Safe
 * to re-run: it restores a pool or provider deleted in the last 30 days and
 * brings an existing provider back in line with the credential.
 *
 * Every dynamic value is single-quoted once into a variable and only ever
 * expanded inside double quotes, so no value can break out of the script.
 */
export const gcpSetupScript = (options: {
  projectNumber: string
  providerId: string
  issuer: string
  subject: string
  jwks: string
  integration: GcpIntegration
  poolId?: string
}) => `(
set -euo pipefail
PROJECT_NUMBER=${shellQuote(options.projectNumber.trim())}
POOL_ID=${shellQuote(options.poolId ?? GCP_POOL_ID)}
PROVIDER_ID=${shellQuote(options.providerId)}
ISSUER=${shellQuote(options.issuer)}
SUBJECT=${shellQuote(options.subject)}
PRINCIPAL="principal://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/$POOL_ID/subject/$SUBJECT"

${enableApisCommand('PROJECT_NUMBER', options.integration, [
  'iam.googleapis.com',
  'sts.googleapis.com',
  'cloudresourcemanager.googleapis.com',
])}
# gcloud's Workload Identity commands take the project ID, not the number.
PROJECT_ID="$(gcloud projects describe "$PROJECT_NUMBER" --format='value(projectId)')"

# Phase's public key for this credential.
printf '%s\\n' ${shellQuote(options.jwks)} > phase-jwks.json

POOL_STATE="$(gcloud iam workload-identity-pools describe "$POOL_ID" --location=global \\
  --project="$PROJECT_ID" --format='value(state)' 2>/dev/null || true)"
if [ -z "$POOL_STATE" ]; then
  gcloud iam workload-identity-pools create "$POOL_ID" --location=global \\
    --project="$PROJECT_ID" --display-name="Phase"
elif [ "$POOL_STATE" = "DELETED" ]; then
  gcloud iam workload-identity-pools undelete "$POOL_ID" --location=global \\
    --project="$PROJECT_ID"
fi

PROVIDER_STATE="$(gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \\
  --location=global --workload-identity-pool="$POOL_ID" --project="$PROJECT_ID" \\
  --format='value(state)' 2>/dev/null || true)"
if [ "$PROVIDER_STATE" = "DELETED" ]; then
  gcloud iam workload-identity-pools providers undelete "$PROVIDER_ID" \\
    --location=global --workload-identity-pool="$POOL_ID" --project="$PROJECT_ID"
fi
if [ -z "$PROVIDER_STATE" ]; then ACTION=create-oidc; else ACTION=update-oidc; fi
gcloud iam workload-identity-pools providers "$ACTION" "$PROVIDER_ID" \\
  --location=global --workload-identity-pool="$POOL_ID" --project="$PROJECT_ID" \\
  --display-name="Phase" --issuer-uri="$ISSUER" --jwk-json-path=phase-jwks.json \\
  --attribute-mapping="google.subject=assertion.sub" \\
  --attribute-condition="assertion.sub == \\"$SUBJECT\\""

${grantRolesCommands('PROJECT_ID', options.integration)}

echo "Done: Google Cloud now trusts this Phase integration."
)
`

/**
 * A script that lets a project's Secret Manager service agent use a CMEK
 * key. Google encrypts with the key as that agent, not as the caller, so
 * Phase's principal never needs access to it. Safe to re-run.
 */
export const gcpKmsGrantScript = (options: { project: string; kmsKeyName: string }) => `(
set -euo pipefail
PROJECT=${shellQuote(options.project.trim())}
KMS_KEY=${shellQuote(options.kmsKeyName.trim())}

# Secret Manager encrypts with the key as this project's service agent.
gcloud beta services identity create --service=secretmanager.googleapis.com \\
  --project="$PROJECT"
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
gcloud kms keys add-iam-policy-binding "$KMS_KEY" \\
  --member="serviceAccount:service-$PROJECT_NUMBER@gcp-sa-secretmanager.iam.gserviceaccount.com" \\
  --role=roles/cloudkms.cryptoKeyEncrypterDecrypter --condition=None >/dev/null

echo "Done: Secret Manager can now encrypt with this key."
)
`

export type GcpPublicKey = {
  keyId: string
  algorithm: string
  keyType: string
  use: string
  bits: number | null
  exponent: number | null
  modulus: string
}

const base64UrlToBytes = (value: string) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

/** The keys in a stored JWKS, for display. Null when it can't be read. */
export const parseJwks = (jwks: string): GcpPublicKey[] | null => {
  let keys: unknown
  try {
    keys = JSON.parse(jwks)?.keys
  } catch {
    return null
  }
  if (!Array.isArray(keys) || keys.length === 0) return null
  return keys.map((key: Record<string, string>) => {
    let bits: number | null = null
    let exponent: number | null = null
    try {
      bits = key.n ? base64UrlToBytes(key.n).length * 8 : null
    } catch {}
    try {
      exponent = key.e
        ? base64UrlToBytes(key.e).reduce((value, byte) => value * 256 + byte, 0)
        : null
    } catch {}
    return {
      keyId: key.kid ?? '',
      algorithm: key.alg ?? '',
      keyType: key.kty ?? '',
      use: key.use ?? '',
      bits,
      exponent,
      modulus: key.n ?? '',
    }
  })
}
