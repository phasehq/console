import {
  ApiEnvironmentEnvTypeChoices,
  ApiSecretTypeChoices,
  AppType,
  EnvironmentKeyInput,
  EnvironmentType,
  MemberType,
  MutationCreateAppArgs,
  OrganisationMemberType,
  OrganisationType,
  SecretInput,
  SecretType,
  ServiceAccountType,
} from '@/apollo/graphql'
import { CreateApplication } from '@/graphql/mutations/createApp.gql'
import { CreateEnv } from '@/graphql/mutations/environments/createEnvironment.gql'
import { BulkAddMembersToApp } from '@/graphql/mutations/apps/bulkAddAppMembers.gql'
import { AddTeamAppsOp } from '@/graphql/mutations/teams/addTeamApps.gql'
import InitAppSyncing from '@/graphql/mutations/syncing/initAppSync.gql'
import GetServerKey from '@/graphql/queries/syncing/getServerKey.gql'
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
  encryptSecretsForEnv,
  wrapEnvSecretsForAccount,
  wrapEnvSecretsForServer,
} from '@/utils/crypto'
import { graphQlClient as client } from '@/apollo/client'

const EXAMPLE_APP_README = `## Example App

This is an example application with some dummy secrets to help you get started with Phase.

### App README

App READMEs support Markdown rendering, making them a great place for developer documentation, runbooks, and notes.

### What you can do here

- Write onboarding docs for your team
- Document environment-specific configuration
- Add links to related resources and dashboards

### Code blocks

\`\`\`bash
# Install the Phase CLI
curl -fsSL https://pkg.phase.dev/install.sh | bash
\`\`\`

\`\`\`bash
# Initialize and pull secrets
phase init
phase secrets list
\`\`\`

> You can edit this README in **Settings**.
`

// Define the KeyringType interface
export interface KeyringType {
  publicKey: string
  privateKey: string
  symmetricKey: string
}

/** An environment a new App starts with */
export type NewAppEnvironment = {
  name: string
  envType: ApiEnvironmentEnvTypeChoices
  /** Unset: clients show the default, stoplight for the standard three and from the name for others */
  color?: string | null
  /** The App's primary environment. Unset: the server makes Production its primary one */
  isPrimary?: boolean | null
}

export const DEFAULT_APP_ENVIRONMENTS: NewAppEnvironment[] = [
  { name: 'Development', envType: ApiEnvironmentEnvTypeChoices.Dev },
  { name: 'Staging', envType: ApiEnvironmentEnvTypeChoices.Staging },
  { name: 'Production', envType: ApiEnvironmentEnvTypeChoices.Prod },
]

/** An account to give access to some of a new App's environments, given by their place in its list */
export type NewAppAccess = {
  account: OrganisationMemberType | ServiceAccountType
  memberType: MemberType
  environments: number[]
}

/** A team to give access to some of a new App's environments, given by their place in its list */
export type NewAppTeamAccess = { teamId: string; environments: number[] }

/** Secrets for one of a new App's environments, given by its place in the list */
export type NewAppSecrets = {
  environment: number
  secrets: Array<Pick<SecretType, 'key' | 'value' | 'comment' | 'path' | 'type' | 'tags'>>
}

/** What was created. An environment that couldn't be is null, in its place */
export type CreatedApp = {
  id: string
  environments: ({ id: string; name: string } | null)[]
  /** Whether the secrets were imported, into the environments that were created */
  secretsImported: boolean
  /** Whether the access asked for was given, to the environments that were created */
  accessGiven: boolean
  /** Whether the teams asked for were given access, server-side encryption turned on for them */
  teamsGiven: boolean
  /** Whether server-side encryption is on: asked for, or turned on for teams */
  sseEnabled: boolean
}

interface CreateAppOptions {
  name: string
  organisation: OrganisationType
  keyring: KeyringType
  globalAccessUsers: any[]
  createExampleSecrets?: boolean
  environments?: NewAppEnvironment[]
  secrets?: NewAppSecrets[]
  access?: NewAppAccess[]
  /** Teams get their keys from the server, so asking for any turns server-side encryption on */
  teams?: NewAppTeamAccess[]
  /** Turns server-side encryption on once the environments exist */
  serverSideEncryption?: boolean
  /** Told what is being done, for a progress line */
  onProgress?: (stage: string) => void
}

export const DEV_SECRETS = [
  {
    key: 'SATELLITE_HANDOFF_KEY',
    value: 'hndfrk_sjdh23h2j3h2',
    comment: '',
    type: ApiSecretTypeChoices.Secret,
  },
  {
    key: 'BANDWIDTH_ALLOCATION_KEY',
    value: 'bwalloc_key_28dhj3j3',
    comment: '',
    type: ApiSecretTypeChoices.Secret,
  },
  {
    key: 'AWS_ACCESS_KEY_ID',
    value: 'AKIAIX4ONRSG6ODEFVJA',
    comment: '',
    type: ApiSecretTypeChoices.Secret,
  },
  {
    key: 'AWS_SECRET_ACCESS_KEY',
    value: 'aCRAMarEbFC3Q5c24pi7AVMIt6TaCfHeFZ4KCf/a',
    comment: '',
    type: ApiSecretTypeChoices.Sealed,
  },
  {
    key: 'MAINTENANCE_MODE',
    value: 'True',
    comment: '',
    type: ApiSecretTypeChoices.Config,
  },
  {
    key: 'SIGNAL_ENCRYPTION_KEY',
    value: 'sek_starlink_dev_v1_8x8j2k',
    comment: '',
    type: ApiSecretTypeChoices.Sealed,
  },
  {
    key: 'FIRMWARE_UPDATE_URL',
    value: 'https://starlink-firmware-updates-gbs-dev-1.s3.us-central-1.amazonaws.com/firmware',
    comment: '',
    type: ApiSecretTypeChoices.Config,
  },
  {
    key: 'GROUNDSTATION_CERTIFICATE_PATH',
    value: '/etc/ssl/certs/gs_cert.pem',
    comment: '',
    type: ApiSecretTypeChoices.Config,
  },
  {
    key: 'GROUNDSTATION_PRIVATE_KEY_PATH',
    value: '/etc/ssl/private/gs_private_key.pem',
    comment: '',
    type: ApiSecretTypeChoices.Config,
  },
  {
    key: 'WIREGUARD_KEY',
    value: 'wg_key_HJu2xOjZTKPviO22y9KqNQMI9ejSM6TNEsACKv7kB7k=',
    comment: '',
    type: ApiSecretTypeChoices.Sealed,
  },
  {
    key: 'POSTGRES_CONNECTION_STRING',
    value:
      'postgresql://spacex_stag:c51bdc6b6e8685f113a4ab5d57481b8b20d8d06a6526f5e2e4535ffa398850a2@starlink-telemetry-db-stag.cluster-c9ufzjtplsaq.us-central-1.rds.amazonaws.com:5432/starlink_telemetry',
    comment: 'RDS Aurora PostgreSQL - US Central - DEV',
    type: ApiSecretTypeChoices.Secret,
  },
]

export const STAG_SECRETS = [
  {
    key: 'SATELLITE_HANDOFF_KEY',
    value: 'hndfrk_stag_k2j3h4k2j3',
    comment: '',
    type: ApiSecretTypeChoices.Secret,
  },
  {
    key: 'BANDWIDTH_ALLOCATION_KEY',
    value: 'bwalloc_key_stag_93hdk2',
    comment: '',
    type: ApiSecretTypeChoices.Secret,
  },
  {
    key: 'MAINTENANCE_MODE',
    value: 'False',
    comment: '',
    type: ApiSecretTypeChoices.Config,
  },
  {
    key: 'SIGNAL_ENCRYPTION_KEY',
    value: 'sek_starlink_stag_v1_9x9k3m',
    comment: '',
    type: ApiSecretTypeChoices.Sealed,
  },
  {
    key: 'FIRMWARE_UPDATE_URL',
    value: 'https://updates-staging.spacex.com/firmware',
    comment: '',
    type: ApiSecretTypeChoices.Config,
  },
  {
    key: 'WIREGUARD_KEY',
    value: 'wg_falcon9_stag_key_39dj3k3h3j3h3j3h3j3h3j3h3j3',
    comment: '',
    type: ApiSecretTypeChoices.Sealed,
  },
  {
    key: 'POSTGRES_CONNECTION_STRING',
    value:
      'postgresql://spacex_stag:7d48921fc7e85fd3339527d39557@starlink-telemetry-db-stag.cluster-c9ufzjtplsaq.us-central-1.rds.amazonaws.com:5432/starlink_telemetry',
    comment: 'RDS Aurora PostgreSQL - US Central',
    type: ApiSecretTypeChoices.Secret,
  },
  {
    key: 'DISABLE_STARLINK_COORDINATES',
    value: 'None',
    comment: '',
    type: ApiSecretTypeChoices.Config,
  },
]

export const PROD_SECRETS = [
  {
    key: 'JWT_SECRET',
    value:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjMzNjIwMTcxLCJleHAiOjIyMDg5ODUyMDB9.pHnckabbMbwTHAJOkb5Z7G7B4chY6GllJf6K2m96z3A',
    comment: '',
    type: ApiSecretTypeChoices.Sealed,
  },
  {
    key: 'SATELLITE_HANDOFF_KEY',
    value: 'hndfrk_prod_p8k4m5n2',
    comment: 'Production Satellite Handoff Key',
    type: ApiSecretTypeChoices.Secret,
  },
  {
    key: 'BANDWIDTH_ALLOCATION_KEY',
    value: 'bwalloc_key_prod_74msk2',
    comment: 'Production Bandwidth Key',
    type: ApiSecretTypeChoices.Secret,
  },
  {
    key: 'MAINTENANCE_MODE',
    value: 'False',
    comment: '',
    type: ApiSecretTypeChoices.Config,
  },
  {
    key: 'SIGNAL_ENCRYPTION_KEY',
    value:
      'sek_starlink_prod_v2_+ScgHNaH6uZpqFRST+Q2Cq+KlaExlUEtFZrPNrgokzicou97GD/UUsEAJrjb3tfOblUt15e2dir0L671W+OwBw==',
    comment: 'Production Signal Encryption Key',
    type: ApiSecretTypeChoices.Sealed,
  },
  {
    key: 'FIRMWARE_UPDATE_URL',
    value: 'https://ota.spacex.com/firmware',
    comment: 'Production Firmware Update Endpoint',
    type: ApiSecretTypeChoices.Config,
  },
  {
    key: 'WIREGUARD_KEY',
    value: 'wg_prod_key_e4bd19c3b17cf205f969b3c2bfd69173477db64dff71a8d7f8ca3ab8b39154f8',
    comment: 'Production WireGuard Key',
    type: ApiSecretTypeChoices.Sealed,
  },
  {
    key: 'POSTGRES_CONNECTION_STRING',
    value:
      'postgresql://spacex_stag:268ff4edd81533a32b80645844b6afdcc48a4041ffda000c3c5ff3505777eda8@starlink-telemetry-db-prod.cluster-c9ufzjtplsaq.us-central-1.rds.amazonaws.com:5432/starlink_telemetry',
    comment: 'RDS Aurora PostgreSQL - US Central - PROD',
    type: ApiSecretTypeChoices.Secret,
  },
  {
    key: 'DISABLE_STARLINK_COORDINATES',
    value: '46.1092°N,33.6925°E,44.6166°N,33.5254°E,44.5000°N,34.1667°E',
    comment: "Prevent WW3 - Elon's orders",
    type: ApiSecretTypeChoices.Config,
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
          // The API stores lowercase values; ApiSecretTypeChoices holds the uppercase GraphQL names
          type: secret.type?.toLowerCase(),
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

type CreatedEnvironment = {
  id: string
  name: string
  identityKey: string
  envSecrets: { seed: string; salt: string }
}

/** Creates one environment, its keys wrapped for the Owner, the global-access members and the creator */
async function createAppEnvironment(
  appId: string,
  env: NewAppEnvironment,
  globalAccessUsers: any[]
): Promise<CreatedEnvironment> {
  const { createEnvPayload, adminKeysPayload, envSecrets } = await createNewEnv(
    appId,
    env.name,
    env.envType,
    globalAccessUsers
  )
  const { data } = await client.mutate({
    mutation: CreateEnv,
    variables: {
      envInput: { ...createEnvPayload, color: env.color || null, isPrimary: env.isPrimary ?? null },
      adminKeys: adminKeysPayload,
    },
  })
  const created = data?.createEnvironment?.environment
  if (!created) throw new Error(`${env.name} was not created`)
  return { id: created.id, name: created.name, identityKey: created.identityKey, envSecrets }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

/** Encrypts each environment's secrets under its keys and stores them all in one request */
async function importSecrets(
  created: (CreatedEnvironment | null)[],
  secrets: NewAppSecrets[],
  onProgress?: (stage: string) => void
): Promise<boolean> {
  const batches = secrets
    .map(({ environment, secrets }) => ({ env: created[environment], secrets }))
    .filter(({ env, secrets }) => env && secrets.length > 0)
  if (batches.length === 0) return true

  const keys = new Set(batches.flatMap(({ secrets }) => secrets.map((secret) => secret.key)))
  onProgress?.(`Importing ${plural(keys.size, 'secret')}…`)
  try {
    const secretsToCreate = (
      await Promise.all(
        batches.map(({ env, secrets }) =>
          encryptSecretsForEnv(secrets, {
            id: env!.id,
            identityKey: env!.identityKey,
            salt: env!.envSecrets.salt,
          })
        )
      )
    ).flat()
    await client.mutate({
      mutation: BulkProcessSecrets,
      variables: { secretsToCreate, secretsToUpdate: [], secretsToDelete: [] },
    })
    return true
  } catch {
    return false
  }
}

/** The environments each team is given, by id: a team left with none is dropped */
const teamGrants = (created: (CreatedEnvironment | null)[], teams: NewAppTeamAccess[]) =>
  teams
    .map(({ teamId, environments }) => ({
      teamId,
      envIds: environments.flatMap((at) => (created[at] ? [created[at]!.id] : [])),
    }))
    .filter(({ envIds }) => envIds.length > 0)

/**
 * Turns server-side encryption on, as the App's settings do: the keys made here for each
 * environment are wrapped for the server, which then holds a copy of them.
 */
async function enableServerSideEncryption(
  appId: string,
  created: (CreatedEnvironment | null)[],
  onProgress?: (stage: string) => void
): Promise<boolean> {
  const environments = created.filter((env): env is CreatedEnvironment => !!env)
  // The server needs a key for every environment, and turns nothing on for an App with none
  if (environments.length === 0) return false

  onProgress?.('Turning on server-side encryption…')
  try {
    const { data } = await client.query({ query: GetServerKey, fetchPolicy: 'network-only' })
    const envKeys = await Promise.all(
      environments.map(async (env) => ({
        envId: env.id,
        identityKey: env.identityKey,
        ...(await wrapEnvSecretsForServer(env.envSecrets, data.serverPublicKey)),
      }))
    )
    await client.mutate({ mutation: InitAppSyncing, variables: { appId, envKeys } })
    return true
  } catch {
    return false
  }
}

/** Gives each team its environments: the server wraps their keys for the team's members */
async function giveTeamsAccess(
  appId: string,
  grants: ReturnType<typeof teamGrants>,
  onProgress?: (stage: string) => void
): Promise<boolean> {
  onProgress?.(`Giving ${plural(grants.length, 'team')} access…`)
  let given = true
  for (const { teamId, envIds } of grants) {
    try {
      await client.mutate({
        mutation: AddTeamAppsOp,
        variables: { teamId, appEnvs: [{ appId, envIds }] },
      })
    } catch {
      given = false
    }
  }
  return given
}

/** Adds the accounts to the App with their environments' keys, all in one request */
async function giveAccess(
  appId: string,
  created: (CreatedEnvironment | null)[],
  access: NewAppAccess[],
  onProgress?: (stage: string) => void
): Promise<boolean> {
  const grants = access
    .map(({ account, memberType, environments }) => ({
      account,
      memberType,
      envs: environments.map((at) => created[at]).filter((env): env is CreatedEnvironment => !!env),
    }))
    .filter(({ envs }) => envs.length > 0)
  if (grants.length === 0) return true

  onProgress?.(`Giving access to ${plural(grants.length, 'account')}…`)
  try {
    const members = await Promise.all(
      grants.map(async ({ account, memberType, envs }) => ({
        memberId: account.id,
        memberType,
        envKeys: await Promise.all(
          envs.map(async (env): Promise<EnvironmentKeyInput> => {
            const { wrappedSeed, wrappedSalt } = await wrapEnvSecretsForAccount(
              env.envSecrets,
              account
            )
            return {
              envId: env.id,
              userId: account.id,
              identityKey: env.identityKey,
              wrappedSeed,
              wrappedSalt,
            }
          })
        ),
      }))
    )
    const { data } = await client.mutate({
      mutation: BulkAddMembersToApp,
      variables: { appId, members },
    })
    return Boolean(data?.bulkAddAppMembers?.app)
  } catch {
    return false
  }
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

/**
 * Creates an App with its environments, one at a time in the order given so each goes after the
 * last, then gives the accounts in `access` their environments. Once the App exists, an environment
 * or access that fails is reported in the result rather than thrown: the App is there to fix it in.
 */
export async function createApplication({
  name,
  organisation,
  keyring,
  globalAccessUsers,
  createExampleSecrets: withExampleSecrets = false, // Explicitly false by default
  environments = DEFAULT_APP_ENVIRONMENTS,
  secrets = [],
  access = [],
  teams = [],
  serverSideEncryption = false,
  onProgress,
}: CreateAppOptions): Promise<CreatedApp> {
  const id = crypto.randomUUID()

  onProgress?.('Creating the App…')
  const { data } = await client.mutate({
    mutation: CreateApplication,
    variables: {
      id,
      name,
      organisationId: organisation.id,
    } as MutationCreateAppArgs,
  })

  const newAppId = data.createApp.app.id

  const created: (CreatedEnvironment | null)[] = []
  for (const [at, env] of environments.entries()) {
    onProgress?.(
      environments.length > 1
        ? `Creating Environments (${at + 1} of ${environments.length})…`
        : 'Creating the Environment…'
    )
    created.push(await createAppEnvironment(newAppId, env, globalAccessUsers).catch(() => null))
  }

  // The encryption mode is settled before anything goes into the App. Teams need it on
  const grants = teamGrants(created, teams)
  const sseEnabled =
    (serverSideEncryption || grants.length > 0) &&
    (await enableServerSideEncryption(newAppId, created, onProgress))

  const secretsImported = await importSecrets(created, secrets, onProgress)
  const accessGiven = await giveAccess(newAppId, created, access, onProgress)
  const teamsGiven =
    grants.length === 0 || (sseEnabled && (await giveTeamsAccess(newAppId, grants, onProgress)))

  if (withExampleSecrets) {
    await createExampleSecrets(newAppId, keyring)
    await client.mutate({
      mutation: UpdateAppInfoOp,
      variables: { id: newAppId, description: EXAMPLE_APP_README },
    })
  }

  // The App exists whether or not the list catches up now
  await client
    .query({
      query: GetApps,
      variables: { organisationId: organisation.id },
      fetchPolicy: 'network-only',
    })
    .catch(() => {})

  return {
    id: newAppId,
    environments: created.map((env) => env && { id: env.id, name: env.name }),
    secretsImported,
    accessGiven,
    teamsGiven,
    sseEnabled,
  }
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
