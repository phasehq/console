import {
  ApiEnvironmentEnvTypeChoices,
  AppType,
  EnvironmentType,
  MutationCreateAppArgs,
  OrganisationType,
  SecretInput,
  SecretType,
} from '@/apollo/graphql'
import { CreateApplication } from '@/graphql/mutations/createApp.gql'
import { InitAppEnvironments } from '@/graphql/mutations/environments/initAppEnvironments.gql'
import { BulkProcessSecrets } from '@/graphql/mutations/environments/bulkProcessSecrets.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { UpdateAppInfoOp } from '@/graphql/mutations/apps/updateAppInfo.gql'
import {
  getUserKxPublicKey,
  getUserKxPrivateKey,
  decryptAsymmetric,
  encryptAsymmetric,
  digest,
  createNewEnv,
  splitSecret,
  appKeyring,
  newAppSeed,
  newAppToken,
  newAppWrapKey,
  encryptAppSeed,
  getWrappedKeyShare,
} from '@/utils/crypto'
import { graphQlClient as client } from '@/apollo/client'

const APP_VERSION = 1

const EXAMPLE_APP_DESCRIPTION = `## Example App

This is an example application with some dummy secrets to help you get started with Phase.

### App Descriptions

App descriptions support **Markdown** rendering — making them a great place for developer documentation, runbooks, and notes.

### What you can do here

- Write onboarding docs for your team
- Document environment-specific configuration
- Add links to related resources and dashboards

### Code blocks

\`\`\`bash
# Install the Phase CLI
curl -fsSL https://pkg.phase.dev/install.sh | bash
\`\`\`

\`\`\`

# Initialize and pull secrets
phase init
phase secrets list
\`\`\`

> You can edit this description in **Settings**.
`

// Define the KeyringType interface
export interface KeyringType {
  publicKey: string
  privateKey: string
  symmetricKey: string
}

interface CreateAppOptions {
  name: string
  organisation: OrganisationType
  keyring: KeyringType
  globalAccessUsers: any[]
  createExampleSecrets?: boolean
}

export const DEV_SECRETS = [
  {
    key: 'SATELLITE_HANDOFF_KEY',
    value: 'hndfrk_sjdh23h2j3h2',
    comment: '',
  },
  {
    key: 'BANDWIDTH_ALLOCATION_KEY',
    value: 'bwalloc_key_28dhj3j3',
    comment: '',
  },
  {
    key: 'AWS_ACCESS_KEY_ID',
    value: 'AKIAIX4ONRSG6ODEFVJA',
    comment: '',
  },
  {
    key: 'AWS_SECRET_ACCESS_KEY',
    value: 'aCRAMarEbFC3Q5c24pi7AVMIt6TaCfHeFZ4KCf/a',
    comment: '',
  },
  {
    key: 'MAINTENANCE_MODE',
    value: 'True',
    comment: '',
  },
  {
    key: 'SIGNAL_ENCRYPTION_KEY',
    value: 'sek_starlink_dev_v1_8x8j2k',
    comment: '',
  },
  {
    key: 'FIRMWARE_UPDATE_URL',
    value: 'https://starlink-firmware-updates-gbs-dev-1.s3.us-central-1.amazonaws.com/firmware',
    comment: '',
  },
  {
    key: 'GROUNDSTATION_CERTIFICATE_PATH',
    value: '/etc/ssl/certs/gs_cert.pem',
    comment: '',
  },
  {
    key: 'GROUNDSTATION_PRIVATE_KEY_PATH',
    value: '/etc/ssl/private/gs_private_key.pem',
    comment: '',
  },
  {
    key: 'WIREGUARD_KEY',
    value: 'wg_key_HJu2xOjZTKPviO22y9KqNQMI9ejSM6TNEsACKv7kB7k=',
    comment: '',
  },
  {
    key: 'POSTGRES_CONNECTION_STRING',
    value:
      'postgresql://spacex_stag:c51bdc6b6e8685f113a4ab5d57481b8b20d8d06a6526f5e2e4535ffa398850a2@starlink-telemetry-db-stag.cluster-c9ufzjtplsaq.us-central-1.rds.amazonaws.com:5432/starlink_telemetry',
    comment: 'RDS Aurora PostgreSQL - US Central - DEV',
  },
]

export const STAG_SECRETS = [
  {
    key: 'SATELLITE_HANDOFF_KEY',
    value: 'hndfrk_stag_k2j3h4k2j3',
    comment: '',
  },
  {
    key: 'BANDWIDTH_ALLOCATION_KEY',
    value: 'bwalloc_key_stag_93hdk2',
    comment: '',
  },
  {
    key: 'MAINTENANCE_MODE',
    value: 'False',
    comment: '',
  },
  {
    key: 'SIGNAL_ENCRYPTION_KEY',
    value: 'sek_starlink_stag_v1_9x9k3m',
    comment: '',
  },
  {
    key: 'FIRMWARE_UPDATE_URL',
    value: 'https://updates-staging.spacex.com/firmware',
    comment: '',
  },
  {
    key: 'WIREGUARD_KEY',
    value: 'wg_falcon9_stag_key_39dj3k3h3j3h3j3h3j3h3j3h3j3',
    comment: '',
  },
  {
    key: 'POSTGRES_CONNECTION_STRING',
    value:
      'postgresql://spacex_stag:7d48921fc7e85fd3339527d39557@starlink-telemetry-db-stag.cluster-c9ufzjtplsaq.us-central-1.rds.amazonaws.com:5432/starlink_telemetry',
    comment: 'RDS Aurora PostgreSQL - US Central',
  },
  {
    key: 'DISABLE_STARLINK_COORDINATES',
    value: 'None',
    comment: '',
  },
]

export const PROD_SECRETS = [
  {
    key: 'JWT_SECRET',
    value:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjMzNjIwMTcxLCJleHAiOjIyMDg5ODUyMDB9.pHnckabbMbwTHAJOkb5Z7G7B4chY6GllJf6K2m96z3A',
    comment: '',
  },
  {
    key: 'SATELLITE_HANDOFF_KEY',
    value: 'hndfrk_prod_p8k4m5n2',
    comment: 'Production Satellite Handoff Key',
  },
  {
    key: 'BANDWIDTH_ALLOCATION_KEY',
    value: 'bwalloc_key_prod_74msk2',
    comment: 'Production Bandwidth Key',
  },
  {
    key: 'MAINTENANCE_MODE',
    value: 'False',
    comment: '',
  },
  {
    key: 'SIGNAL_ENCRYPTION_KEY',
    value:
      'sek_starlink_prod_v2_+ScgHNaH6uZpqFRST+Q2Cq+KlaExlUEtFZrPNrgokzicou97GD/UUsEAJrjb3tfOblUt15e2dir0L671W+OwBw==',
    comment: 'Production Signal Encryption Key',
  },
  {
    key: 'FIRMWARE_UPDATE_URL',
    value: 'https://ota.spacex.com/firmware',
    comment: 'Production Firmware Update Endpoint',
  },
  {
    key: 'WIREGUARD_KEY',
    value: 'wg_prod_key_e4bd19c3b17cf205f969b3c2bfd69173477db64dff71a8d7f8ca3ab8b39154f8',
    comment: 'Production WireGuard Key',
  },
  {
    key: 'POSTGRES_CONNECTION_STRING',
    value:
      'postgresql://spacex_stag:268ff4edd81533a32b80645844b6afdcc48a4041ffda000c3c5ff3505777eda8@starlink-telemetry-db-prod.cluster-c9ufzjtplsaq.us-central-1.rds.amazonaws.com:5432/starlink_telemetry',
    comment: 'RDS Aurora PostgreSQL - US Central - PROD',
  },
  {
    key: 'DISABLE_STARLINK_COORDINATES',
    value: '46.1092°N,33.6925°E,44.6166°N,33.5254°E,44.5000°N,34.1667°E',
    comment: "Prevent WW3 - Elon's orders",
  },
]

/**
 * Encrypts a set of secrets for the given env and creates them server-side
 *
 * @param {EnvironmentType} env - The environment in which the secrets will be created.
 * @param {Array<Partial<SecretType>>} secrets - An array of secrets to be processed.
 * @returns {Promise<void>} A Promise that resolves when the all secrets are encrypted and stored on the server.
 *
 * @throws {Error} If the specified environment is invalid or if an error occurs during processing.
 */
async function processSecrets(
  envs: Array<{ env: EnvironmentType; secrets: Array<Partial<SecretType>> }>,
  keyring: KeyringType
) {
  const userKxKeys = {
    publicKey: await getUserKxPublicKey(keyring.publicKey),
    privateKey: await getUserKxPrivateKey(keyring.privateKey),
  }

  const allSecretsToCreate: SecretInput[] = []

  await Promise.all(
    envs.map(async ({ env, secrets }) => {
      const envSalt = await decryptAsymmetric(
        env.wrappedSalt!,
        userKxKeys.privateKey,
        userKxKeys.publicKey
      )

      const envSecretsPromises = secrets.map(async (secret) => {
        const { key, value, comment } = secret

        const encryptedKey = await encryptAsymmetric(key!, env.identityKey)
        const encryptedValue = await encryptAsymmetric(value!, env.identityKey)
        const keyDigest = await digest(key!, envSalt)
        const encryptedComment = await encryptAsymmetric(comment!, env.identityKey)

        allSecretsToCreate.push({
          envId: env.id,
          key: encryptedKey,
          keyDigest,
          value: encryptedValue,
          path: '/',
          comment: encryptedComment,
          tags: [], // Adjust as necessary if you need to include tags
        })
      })

      await Promise.all(envSecretsPromises)
    })
  )

  // Use the bulkProcessSecrets mutation
  await client.mutate({
    mutation: BulkProcessSecrets,
    variables: {
      secretsToCreate: allSecretsToCreate,
      secretsToUpdate: [],
      secretsToDelete: [],
    },
  })
}

/**
 * Initialize application environments for a given application ID.
 *
 * @param {string} appId - The ID of the application for which environments will be initialized.
 * @returns {Promise<boolean>} A Promise that resolves to `true` when initialization is complete.
 *
 * @throws {Error} If there are any errors during the environment initialization process.
 */
async function initAppEnvs(appId: string, globalAccessUsers: any[]) {
  const mutationPayload = {
    devEnv: await createNewEnv(
      appId,
      'Development',
      ApiEnvironmentEnvTypeChoices.Dev,
      globalAccessUsers
    ),
    stagingEnv: await createNewEnv(
      appId,
      'Staging',
      ApiEnvironmentEnvTypeChoices.Staging,
      globalAccessUsers
    ),
    prodEnv: await createNewEnv(
      appId,
      'Production',
      ApiEnvironmentEnvTypeChoices.Prod,
      globalAccessUsers
    ),
  }

  await client.mutate({
    mutation: InitAppEnvironments,
    variables: {
      devEnv: mutationPayload.devEnv.createEnvPayload,
      stagingEnv: mutationPayload.stagingEnv.createEnvPayload,
      prodEnv: mutationPayload.prodEnv.createEnvPayload,
      devAdminKeys: mutationPayload.devEnv.adminKeysPayload,
      stagAdminKeys: mutationPayload.stagingEnv.adminKeysPayload,
      prodAdminKeys: mutationPayload.prodEnv.adminKeysPayload,
    },
  })
}

async function createExampleSecrets(appId: string, keyring: KeyringType) {
  const { data: appEnvsData } = await client.query({
    query: GetAppEnvironments,
    variables: { appId },
  })

  const envsToProcess = [
    {
      env: appEnvsData.appEnvironments.find(
        (env: EnvironmentType) => env.envType === ApiEnvironmentEnvTypeChoices.Dev
      ),
      secrets: DEV_SECRETS,
    },
    {
      env: appEnvsData.appEnvironments.find(
        (env: EnvironmentType) => env.envType === ApiEnvironmentEnvTypeChoices.Staging
      ),
      secrets: STAG_SECRETS,
    },
    {
      env: appEnvsData.appEnvironments.find(
        (env: EnvironmentType) => env.envType === ApiEnvironmentEnvTypeChoices.Prod
      ),
      secrets: PROD_SECRETS,
    },
  ]

  const validEnvsToProcess = envsToProcess.filter(({ env }) => env !== undefined)
  await processSecrets(validEnvsToProcess, keyring)
}

export async function createApplication({
  name,
  organisation,
  keyring,
  globalAccessUsers,
  createExampleSecrets: withExampleSecrets = false, // Explicitly false by default
}: CreateAppOptions): Promise<string> {
  const appSeed = await newAppSeed()
  const appToken = await newAppToken()
  const wrapKey = await newAppWrapKey()
  const id = crypto.randomUUID()

  const encryptedAppSeed = await encryptAppSeed(appSeed, keyring.symmetricKey)
  const appKeys = await appKeyring(appSeed)
  const appKeyShares = await splitSecret(appKeys.privateKey)

  const wrappedShare = await getWrappedKeyShare(appKeyShares[1], wrapKey)

  const { data } = await client.mutate({
    mutation: CreateApplication,
    variables: {
      id,
      name,
      organisationId: organisation.id,
      appSeed: encryptedAppSeed,
      appToken,
      wrappedKeyShare: wrappedShare,
      identityKey: appKeys.publicKey,
      appVersion: APP_VERSION,
    } as MutationCreateAppArgs,
  })

  const newAppId = data.createApp.app.id

  await initAppEnvs(newAppId, globalAccessUsers)

  if (withExampleSecrets) {
    await createExampleSecrets(newAppId, keyring)
    await client.mutate({
      mutation: UpdateAppInfoOp,
      variables: { id: newAppId, description: EXAMPLE_APP_DESCRIPTION },
    })
  }

  await client.query({
    query: GetApps,
    variables: { organisationId: organisation.id },
    fetchPolicy: 'network-only',
  })

  return newAppId
}

export type AppSortOption =
  | 'created'
  | '-created'
  | 'updated'
  | '-updated'
  | 'name'
  | '-name'
  | 'members'
  | '-members'
  | 'serviceAccounts'
  | '-serviceAccounts'
  | 'integrations'
  | '-integrations'

export type AppTabs =
  | '/access/members'
  | '/access/service-accounts'
  | 'syncing'
  | 'logs'
  | 'settings'

export const sortApps = (apps: AppType[], sort: AppSortOption): AppType[] => {
  return apps.slice().sort((a, b) => {
    switch (sort) {
      case 'created':
        return new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime()
      case '-created':
        return new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
      case 'updated':
        return new Date(a.updatedAt!).getTime() - new Date(b.updatedAt!).getTime()
      case '-updated':
        return new Date(b.updatedAt!).getTime() - new Date(a.updatedAt!).getTime()
      case 'name':
        return a.name.localeCompare(b.name)
      case '-name':
        return b.name.localeCompare(a.name)
      case 'members':
        return a.members.length - b.members.length
      case '-members':
        return b.members.length - a.members.length
      case 'serviceAccounts':
        return a.serviceAccounts.length - b.serviceAccounts.length
      case '-serviceAccounts':
        return b.serviceAccounts.length - a.serviceAccounts.length
      case 'integrations':
        return (
          a.environments.reduce((acc, env) => acc + (env!.syncs?.length || 0), 0) -
          b.environments.reduce((acc, env) => acc + (env!.syncs?.length || 0), 0)
        )
      case '-integrations':
        return (
          b.environments.reduce((acc, env) => acc + (env!.syncs?.length || 0), 0) -
          a.environments.reduce((acc, env) => acc + (env!.syncs?.length || 0), 0)
        )
      default:
        return 0
    }
  })
}
