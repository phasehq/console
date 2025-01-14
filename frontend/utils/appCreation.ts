import { ApolloClient, ApolloQueryResult } from '@apollo/client'
import {
  ApiEnvironmentEnvTypeChoices,
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

const APP_VERSION = 1

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
  client: ApolloClient<any>
  createExampleSecrets?: boolean
}

export const DEV_SECRETS = [
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
    key: 'JWT_SECRET',
    value:
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjMzNjIwMTcxLCJleHAiOjIyMDg5ODUyMDB9.pHnckabbMbwTHAJOkb5Z7G7B4chY6GllJf6K2m96z3A',
    comment: '',
  },
  {
    key: 'STRIPE_SECRET_KEY',
    value: 'sk_test_EeHnL644i6zo4Iyq4v1KdV9H',
    comment: '',
  },
  {
    key: 'DJANGO_SECRET_KEY',
    value: 'wwf*2#86t64!fgh6yav$aoeuo@u2o@fy&*gg76q!&%6x_wbduad',
    comment: '',
  },
  {
    key: 'DJANGO_DEBUG',
    value: 'True',
    comment: '',
  },
  {
    key: 'POSTGRES_CONNECTION_STRING',
    value: 'postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}',
    comment: 'AWS RDS pgsql - us-west-1',
  },
  {
    key: 'DB_USER',
    value: 'postgres',
    comment: '',
  },
  {
    key: 'DB_HOST',
    value: 'mc-laren-prod-db.c9ufzjtplsaq.us-west-1.rds.amazonaws.com',
    comment: '',
  },
  {
    key: 'DB_NAME',
    value: 'XP1_LM',
    comment: '',
  },
  {
    key: 'DB_PASSWORD',
    value: '6c37810ec6e74ec3228416d2844564fceb99ebd94b29f4334c244db011630b0e',
    comment: '',
  },
  {
    key: 'DB_PORT',
    value: '5432',
    comment: '',
  },
]

export const STAG_SECRETS = [
  {
    key: 'DJANGO_DEBUG',
    value: 'False',
    comment: '',
  },
]

export const PROD_SECRETS = [
  {
    key: 'STRIPE_SECRET_KEY',
    value: 'sk_live_epISNGSkdeXov2frTey7RHAi',
    comment: 'Stripe prod key - Stripe Atlas',
  },
  {
    key: 'DJANGO_DEBUG',
    value: 'False',
    comment: '',
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
  keyring: KeyringType,
  client: ApolloClient<any>
) {
  const userKxKeys = {
    publicKey: await getUserKxPublicKey(keyring.publicKey),
    privateKey: await getUserKxPrivateKey(keyring.privateKey),
  }

  const allSecretsToCreate: SecretInput[] = []

  await Promise.all(
    envs.map(async ({ env, secrets }) => {
      const envSalt = await decryptAsymmetric(
        env.wrappedSalt,
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
async function initAppEnvs(appId: string, globalAccessUsers: any[], client: ApolloClient<any>) {
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

async function createExampleSecrets(appId: string, keyring: KeyringType, client: ApolloClient<any>) {
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
  await processSecrets(validEnvsToProcess, keyring, client)
}

export async function createApplication({
  name,
  organisation,
  keyring,
  globalAccessUsers,
  client,
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

  await initAppEnvs(newAppId, globalAccessUsers, client)

  if (withExampleSecrets) {
    await createExampleSecrets(newAppId, keyring, client)
  }

  await client.query({
    query: GetApps,
    variables: { organisationId: organisation.id },
    fetchPolicy: 'network-only',
  })

  return newAppId
}
