'use client'

import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvSecretsKV } from '@/graphql/queries/secrets/getSecretKVs.gql'
import { InitAppEnvironments } from '@/graphql/mutations/environments/initAppEnvironments.gql'
import { BulkProcessSecrets } from '@/graphql/mutations/environments/bulkProcessSecrets.gql'
import { GetAppSyncStatus } from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { useContext, useEffect, useState } from 'react'
import {
  ApiOrganisationPlanChoices,
  EnvironmentType,
  SecretFolderType,
  SecretInput,
  SecretType,
} from '@/apollo/graphql'
import _sodium from 'libsodium-wrappers-sumo'
import { KeyringContext } from '@/contexts/keyringContext'

import {
  FaArrowRight,
  FaBan,
  FaBoxOpen,
  FaCheckCircle,
  FaChevronRight,
  FaCircle,
  FaCloudUploadAlt,
  FaExchangeAlt,
  FaFolder,
  FaPlus,
  FaSearch,
  FaTimesCircle,
  FaUndo,
} from 'react-icons/fa'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { organisationContext } from '@/contexts/organisationContext'
import { Button } from '@/components/common/Button'
import clsx from 'clsx'
import { Disclosure, Transition } from '@headlessui/react'
import { userHasPermission } from '@/utils/access/permissions'
import Spinner from '@/components/common/Spinner'
import { Card } from '@/components/common/Card'
import { BsListColumnsReverse } from 'react-icons/bs'
import {
  unwrapEnvSecretsForUser,
  decryptEnvSecretKVs,
  digest,
  encryptAsymmetric,
  decryptAsymmetric,
  getUserKxPrivateKey,
  getUserKxPublicKey,
  arraysEqual,
} from '@/utils/crypto'
import { ManageEnvironmentDialog } from '@/components/environments/ManageEnvironmentDialog'
import { CreateEnvironmentDialog } from '@/components/environments/CreateEnvironmentDialog'
import { SwapEnvOrder } from '@/graphql/mutations/environments/swapEnvironmentOrder.gql'
import { EmptyState } from '@/components/common/EmptyState'
import { SplitButton } from '@/components/common/SplitButton'
import { AppSecretRow } from './_components/AppSecretRow'
import { AppSecret, AppFolder, EnvSecrets, EnvFolders } from './types'
import { toast } from 'react-toastify'
import { EnvSyncStatus } from '@/components/syncing/EnvSyncStatus'

const Environments = (props: { environments: EnvironmentType[]; appId: string }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanCreateEnvironments = userHasPermission(
    organisation?.role?.permissions,
    'Environments',
    'create',
    true
  )

  const userCanUpdateEnvironments = userHasPermission(
    organisation?.role?.permissions,
    'Environments',
    'update',
    true
  )

  const allowReordering =
    organisation?.plan !== ApiOrganisationPlanChoices.Fr && userCanUpdateEnvironments

  const { environments, appId } = props

  const pathname = usePathname()

  const [swapEnvs, { loading }] = useMutation(SwapEnvOrder)

  const handleSwapEnvironments = async (env1: EnvironmentType, env2: EnvironmentType) => {
    await swapEnvs({
      variables: { environment1Id: env1.id, environment2Id: env2?.id },
      refetchQueries: [{ query: GetAppEnvironments, variables: { appId } }],
    })
  }

  return (
    <div className="grid grid-cols-4 gap-4 py-4">
      {environments.map((env: EnvironmentType, index: number) => (
        <Card key={env.id}>
          <div className="group">
            <div className="flex gap-4">
              <div className="pt-1.5">
                <BsListColumnsReverse className="text-black dark:text-white text-2xl" />
              </div>
              <div className="space-y-6 w-full">
                <div className="flex items-start justify-between">
                  <Link href={`${pathname}/environments/${env.id}`} className="group">
                    <div className="font-semibold text-lg">{env.name}</div>
                    <div className="text-neutral-500">
                      {env.secretCount} secrets across {env.folderCount} folders
                    </div>
                  </Link>
                  <ManageEnvironmentDialog environment={env} />
                </div>

                <div className="flex items-center">
                  <Link href={`${pathname}/environments/${env.id}`}>
                    <Button variant="primary">
                      Explore <FaArrowRight />
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
            {allowReordering && (
              <div className="flex justify-between items-center opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto">
                <div>
                  {index !== 0 && (
                    <Button
                      variant="secondary"
                      disabled={loading}
                      title={`Swap with ${environments[index - 1].name}`}
                      onClick={() => handleSwapEnvironments(env, environments[index - 1])}
                    >
                      <FaExchangeAlt className="text-xs shrink-0" />
                    </Button>
                  )}
                </div>
                <div>
                  {index !== environments.length - 1 && (
                    <Button
                      variant="secondary"
                      disabled={loading}
                      title={`Swap with ${environments[index + 1].name}`}
                      onClick={() => handleSwapEnvironments(env, environments[index + 1])}
                    >
                      <FaExchangeAlt className="text-xs shrink-0" />
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>
      ))}

      {userCanCreateEnvironments && (
        <Card>
          <div className="flex flex-col w-full h-full">
            <div className="mx-auto my-auto">
              <CreateEnvironmentDialog appId={appId} />
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

export default function Secrets({ params }: { params: { team: string; app: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  // Permissions
  const userCanReadEnvironments = userHasPermission(
    organisation?.role?.permissions,
    'Environments',
    'read',
    true
  )
  const userCanReadSecrets = userHasPermission(
    organisation?.role?.permissions,
    'Secrets',
    'read',
    true
  )
  const userCanReadSyncs = userHasPermission(
    organisation?.role?.permissions,
    'Integrations',
    'read',
    true
  )

  const { data } = useQuery(GetAppEnvironments, {
    variables: {
      appId: params.app,
    },
    fetchPolicy: 'cache-and-network',
    skip: !userCanReadEnvironments,
  })

  const pathname = usePathname()

  const [getEnvSecrets] = useLazyQuery(GetEnvSecretsKV)

  const [serverAppSecrets, setServerAppSecrets] = useState<AppSecret[]>([])
  const [clientAppSecrets, setClientAppSecrets] = useState<AppSecret[]>([])
  const [secretsToDelete, setSecretsToDelete] = useState<string[]>([])
  const [appSecretsToDelete, setAppSecretsToDelete] = useState<string[]>([])

  const [appFolders, setAppFolders] = useState<AppFolder[]>([])
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [initAppEnvironments] = useMutation(InitAppEnvironments)
  const [bulkProcessSecrets, { loading: bulkUpdatePending }] = useMutation(BulkProcessSecrets)

  const [loading, setLoading] = useState(false)

  const savingAndFetching = bulkUpdatePending || loading

  const { keyring } = useContext(KeyringContext)

  const unsavedChanges =
    //check if any secrets are staged for delete
    secretsToDelete.length > 0 ||
    //check if any new secret keys are added
    !arraysEqual(
      clientAppSecrets.map((appSecret) => appSecret.key),
      serverAppSecrets.map((appSecret) => appSecret.key)
    ) ||
    //check if values are modified for existing secrets
    serverAppSecrets.some(
      (appSecret) =>
        !arraysEqual(
          appSecret.envs.map((env) => env.secret?.value),
          clientAppSecrets
            .find((clientAppSecret) => clientAppSecret.id === appSecret.id)
            ?.envs.map((env) => env.secret?.value) ?? []
        )
    )

  const filteredSecrets =
    searchQuery === ''
      ? clientAppSecrets
      : clientAppSecrets.filter((secret) => {
          const searchRegex = new RegExp(searchQuery, 'i')
          return searchRegex.test(secret.key)
        })

  const filteredFolders =
    searchQuery === ''
      ? appFolders
      : appFolders.filter((folder) => {
          const searchRegex = new RegExp(searchQuery, 'i')
          return searchRegex.test(folder.name)
        })

  const { data: syncsData } = useQuery(GetAppSyncStatus, {
    variables: {
      appId: params.app,
    },
    skip: !userCanReadSyncs,
    pollInterval: unsavedChanges ? 0 : 5000,
  })

  /**
   * Fetches encrypted secrets and folders for the given application environments,
   * decrypts them using the user's keyring, and processes the data into a unified
   * format for managing secrets and folders in the application state.
   *
   * @param {EnvironmentType[]} appEnvironments - Array of application environments to fetch and decrypt secrets for.
   * @returns {Promise<void>} Resolves once the secrets and folders are processed and state is updated.
   */
  const fetchAndDecryptAppEnvs = async (appEnvironments: EnvironmentType[]): Promise<void> => {
    setLoading(true)
    const envSecrets = [] as EnvSecrets[]
    const envFolders = [] as EnvFolders[]

    for (const env of appEnvironments) {
      const { data } = await getEnvSecrets({
        variables: {
          envId: env.id,
        },
        fetchPolicy: 'cache-and-network',
      })

      const { wrappedSeed, wrappedSalt } = data.environmentKeys[0]

      const { publicKey, privateKey } = await unwrapEnvSecretsForUser(
        wrappedSeed,
        wrappedSalt,
        keyring!
      )

      const decryptedSecrets = await decryptEnvSecretKVs(data.secrets, {
        publicKey,
        privateKey,
      })

      envSecrets.push({ env, secrets: decryptedSecrets })
      envFolders.push({ env, folders: data.folders })
    }

    // Create a list of unique secret keys
    const secretKeys = Array.from(
      new Set(envSecrets.flatMap((envCard) => envCard.secrets.map((secret) => secret.key)))
    )

    // Create a list of unique folder names
    const folderNames = Array.from(
      new Set(envFolders.flatMap((envCard) => envCard.folders.map((folder) => folder.name)))
    )

    // Transform envCards into an array of AppSecret objects
    const appSecrets = secretKeys.map((key) => {
      const envs = envSecrets.map((envCard) => ({
        env: envCard.env,
        secret: envCard.secrets.find((secret) => secret.key === key) || null,
      }))
      const id = envs.map((env) => env.secret?.id).join('|')
      return { id, key, envs }
    })

    // Transform envFolders into an array of AppFolder objects
    const appFolders = folderNames.map((name) => {
      const envs = envFolders.map((envCard) => ({
        env: envCard.env,
        folder: envCard.folders.find((folder) => folder.name === name) || null,
      }))
      return { name, envs }
    })

    setServerAppSecrets(appSecrets)
    setClientAppSecrets(appSecrets)
    setAppFolders(appFolders)
    setLoading(false)
  }

  const serverSecret = (id: string) => serverAppSecrets.find((secret) => secret.id === id)

  const duplicateKeysExist = () => {
    const keySet = new Set<string>()

    for (const secret of clientAppSecrets) {
      if (keySet.has(secret.key)) {
        return true // Duplicate key found
      }
      keySet.add(secret.key)
    }

    return false // No duplicate keys found
  }

  const blankKeysExist = () => {
    const secretKeysToSync = clientAppSecrets
      .filter((secret) => !appSecretsToDelete.includes(secret.id))
      .map((secret) => secret.key)
    return secretKeysToSync.includes('')
  }

  /**
   * Handles bulk updating of secrets by comparing client-side secrets with server-side secrets
   * and determining which secrets need to be created, updated, or deleted. Secrets are encrypted
   * using the user's keyring before being sent to the server for processing.
   *
   * @returns {Promise<void>} Resolves once the secrets are processed and the application state is updated.
   */
  const handleBulkUpdateSecrets = async () => {
    const userKxKeys = {
      publicKey: await getUserKxPublicKey(keyring!.publicKey),
      privateKey: await getUserKxPrivateKey(keyring!.privateKey),
    }

    const secretsToCreate: SecretInput[] = []
    const secretsToUpdate: SecretInput[] = []

    const clientSecrets: SecretType[] = clientAppSecrets.flatMap((appSecret) =>
      appSecret.envs
        .filter((env) => env.secret !== null) // Ensure we exclude null secrets
        .map((env) => ({
          ...env.secret!,
          key: appSecret.key,
          environment: env.env as EnvironmentType,
        }))
    )

    const serverSecrets: SecretType[] = serverAppSecrets.flatMap((appSecret) =>
      appSecret.envs
        .filter((env) => env.secret !== null) // Ensure we exclude null secrets
        .map((env) => ({
          ...env.secret!,
          key: appSecret.key,
          environment: env.env as EnvironmentType,
        }))
    )

    await Promise.all(
      clientSecrets.map(async (clientSecret, index) => {
        const { id, key, value, comment, tags } = clientSecret

        const isNewSecret = id.split('-')[0] === 'new'
        const serverSecret = serverSecrets.find((secret) => secret.id === id)

        const salt = await decryptAsymmetric(
          clientSecret.environment.wrappedSalt,
          userKxKeys.privateKey!,
          userKxKeys.publicKey!
        )

        const isModified =
          !isNewSecret &&
          serverSecret &&
          (serverSecret.key !== clientSecret.key || serverSecret.value !== clientSecret.value)

        // Only process if the secret is new or has been modified
        if (isNewSecret || isModified) {
          const encryptedKey = await encryptAsymmetric(key, clientSecret.environment.identityKey)
          const encryptedValue = await encryptAsymmetric(
            value,
            clientSecret.environment.identityKey
          )
          const keyDigest = await digest(key, salt)
          const encryptedComment = await encryptAsymmetric(
            comment || '',
            clientSecret.environment.identityKey
          )
          let tagIds: string[] = []

          if (tags) tagIds = tags.map((tag) => tag.id)

          const secretInput: SecretInput = {
            envId: clientSecret.environment.id,
            path: '/',
            key: encryptedKey,
            keyDigest,
            value: encryptedValue,
            comment: encryptedComment,
            tags: tagIds,
          }

          if (isNewSecret) {
            secretsToCreate.push(secretInput)
          } else {
            secretsToUpdate.push({ ...secretInput, id })
          }
        }
      })
    )

    // Only call the mutation if there are changes
    if (secretsToCreate.length > 0 || secretsToUpdate.length > 0 || secretsToDelete.length > 0) {
      const { errors } = await bulkProcessSecrets({
        variables: {
          secretsToCreate,
          secretsToUpdate,
          secretsToDelete,
        },
        refetchQueries: [
          {
            query: GetAppSyncStatus,
            variables: {
              appId: params.app,
            },
          },
        ],
      })

      if (!errors) {
        setSecretsToDelete([])
        setAppSecretsToDelete([])
      }

      await fetchAndDecryptAppEnvs(data?.appEnvironments)
      setLoading(false)
    }
  }

  // Wraps handleBulkUpdateSecrets with some basic validation checks, loading state updates and toasts
  const handleSaveChanges = async () => {
    setLoading(true)

    if (blankKeysExist()) {
      toast.error('Secret keys cannot be empty!')
      setLoading(false)
      return false
    }

    if (duplicateKeysExist()) {
      toast.error('Secret keys cannot be repeated!')
      setLoading(false)
      return false
    }

    await handleBulkUpdateSecrets()

    setLoading(false)

    toast.success('Changes successfully deployed.')
  }

  const handleUpdateSecretKey = (id: string, key: string) => {
    setClientAppSecrets((prevSecrets) =>
      prevSecrets.map((secret) => (secret.id === id ? { ...secret, key } : secret))
    )
  }

  const handleUpdateSecretValue = (id: string, envId: string, value: string | undefined) => {
    const clonedSecrets = structuredClone(clientAppSecrets)

    const secretToUpdate = clonedSecrets.find((secret) => secret.id === id)

    if (!secretToUpdate) return

    secretToUpdate.envs = secretToUpdate.envs.filter((env) => {
      const appSecretEnvValue = env

      if (appSecretEnvValue.env.id === envId) {
        if (value === null || value === undefined) return null

        appSecretEnvValue!.secret!.value = value
      }
      return appSecretEnvValue
    })

    setClientAppSecrets(clonedSecrets)
  }

  const handleAddNewClientSecret = () => {
    const envs: EnvironmentType[] = data?.appEnvironments

    setClientAppSecrets([
      {
        id: crypto.randomUUID(),
        key: '',
        envs: envs.map((environment) => {
          return {
            env: environment,
            secret: {
              id: `new-${crypto.randomUUID()}`,
              updatedAt: null,
              version: 1,
              key: '',
              value: '',
              tags: [],
              comment: '',
              path: '/',
              environment,
            },
          }
        }),
      },
      ...clientAppSecrets,
    ])
  }

  const handleAddNewEnvValue = (appSecretId: string, environment: EnvironmentType) => {
    setClientAppSecrets((prevSecrets) =>
      prevSecrets.map((appSecret) => {
        if (appSecret.id === appSecretId) {
          const newSecret = {
            id: `new-${crypto.randomUUID()}`,
            updatedAt: null,
            version: 1,
            key: '',
            value: '',
            tags: [],
            comment: '',
            path: '/',
            environment,
          }

          const { id, key, envs } = appSecret

          return {
            id,
            key,
            envs: envs.filter((env) => {
              if (env.env.id === environment.id) {
                env.secret = newSecret
              }

              return env
            }),
          }
        }
        return appSecret
      })
    )
  }

  const stageEnvValueForDelete = (appSecretId: string, environment: EnvironmentType) => {
    const appSecret = clientAppSecrets.find((appSecret) => appSecret.id === appSecretId)
    const secretToDelete = appSecret?.envs.find((env) => env.env.id === environment.id)
    if (secretToDelete) {
      // if already staged for delete, remove it from the list
      if (secretsToDelete.includes(secretToDelete.secret!.id)) {
        setSecretsToDelete((prevSecretsToDelete) =>
          prevSecretsToDelete.filter((secretId) => secretId !== secretToDelete.secret!.id)
        )
      } else {
        setSecretsToDelete([...secretsToDelete, secretToDelete.secret!.id])
      }
    }
  }

  const handleStageClientSecretForDelete = (id: string) => {
    const clonedSecrets = structuredClone(clientAppSecrets)

    const secretToDelete = clonedSecrets.find((appSecret) => appSecret?.id === id)

    if (!secretToDelete) return

    // get all non-null secret ids for this app secret
    const secretIds = secretToDelete.envs
      .map((env) => env.secret?.id)
      .filter((id): id is string => id !== undefined)

    // secrets that exist on the server, and need to be deleted server-side
    const existingSecrets = secretIds.filter((secretId) => !secretId.includes('new'))

    // filter out secrets that only exist client-side and can be deleted in memory
    secretToDelete.envs = secretToDelete.envs.filter((env) => !env.secret?.id.includes('new'))

    // if this app secret no longer has any env-values client-side, remove it from memory entirely
    if (secretToDelete.envs.length === 0) {
      const index = clonedSecrets.indexOf(secretToDelete)
      clonedSecrets.splice(index, 1)
    }

    // update states
    // if server-side secrets are already marked for delete, remove them from delete list
    if (existingSecrets.some((existingSecretId) => secretsToDelete.includes(existingSecretId))) {
      setSecretsToDelete(secretsToDelete.filter((secretId) => !existingSecrets.includes(secretId)))
      setAppSecretsToDelete(
        appSecretsToDelete.filter((appSecretId) => appSecretId !== secretToDelete.id)
      )
    } else {
      setSecretsToDelete([...existingSecrets, ...secretIds])
      setAppSecretsToDelete([...appSecretsToDelete, secretToDelete.id])
    }

    setClientAppSecrets(clonedSecrets)
  }

  const handleDiscardChanges = () => {
    setClientAppSecrets(serverAppSecrets)
    setSecretsToDelete([])
    setAppSecretsToDelete([])
  }

  useEffect(() => {
    if (keyring !== null && data?.appEnvironments && userCanReadSecrets)
      fetchAndDecryptAppEnvs(data?.appEnvironments)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.appEnvironments, keyring])

  const EnvFolder = (props: {
    envFolder: {
      env: Partial<EnvironmentType>
      folder: SecretFolderType | null
    }
  }) => {
    const { envFolder } = props

    return (
      <div className="py-2 px-4">
        {envFolder.folder === null ? (
          <span className="text-red-500 font-mono">missing</span>
        ) : (
          <Link
            className="flex items-center gap-2 w-min group font-medium text-sm tracking-wider"
            href={`${pathname}/environments/${envFolder.env.id}${
              envFolder.folder ? `/${envFolder.folder.name}` : ``
            }`}
            title={
              envFolder.folder
                ? `View this folder in ${envFolder.env.envType}`
                : `Manage ${envFolder.env.envType}`
            }
          >
            <div className="flex items-center gap-4">
              <span className="text-gray-500">{envFolder.env.envType}</span>{' '}
              <span className="text-emerald-500">/{envFolder.folder.name}</span>
            </div>
          </Link>
        )}
      </div>
    )
  }

  const AppFolderRow = (props: { appFolder: AppFolder }) => {
    const { appFolder } = props

    const tooltipText = (env: {
      env: Partial<EnvironmentType>
      folder: SecretFolderType | null
    }) => {
      if (env.folder === null) return `This folder is missing in ${env.env.envType}`
      else return 'This folder is present'
    }

    return (
      <Disclosure>
        {({ open }) => (
          <>
            <Disclosure.Button
              as="tr"
              className={clsx(
                'group divide-x divide-neutral-500/40 border-x transition ease duration-100 cursor-pointer',
                open
                  ? 'bg-zinc-100 dark:bg-zinc-800 !border-l-emerald-500 !border-r-neutral-500/40'
                  : ' hover:bg-zinc-100 dark:hover:bg-zinc-800 border-neutral-500/40'
              )}
            >
              <td
                className={clsx(
                  'px-6 py-3 whitespace-nowrap font-mono text-zinc-800 dark:text-zinc-300 flex items-center gap-2 ph-no-capture',
                  open ? 'font-bold' : 'font-medium'
                )}
              >
                <FaFolder className="text-emerald-500" />
                {appFolder.name}
                <FaChevronRight
                  className={clsx(
                    'transform transition ease font-light',
                    open ? 'opacity-100 rotate-90' : 'opacity-0 group-hover:opacity-100 rotate-0'
                  )}
                />
              </td>
              {appFolder.envs.map((env) => (
                <td key={env.env.id} className="px-6 py-3 whitespace-nowrap">
                  <div className="flex items-center justify-center" title={tooltipText(env)}>
                    {env.folder !== null ? (
                      <FaCheckCircle className="text-emerald-500 shrink-0" />
                    ) : (
                      <FaTimesCircle className="text-red-500 shrink-0" />
                    )}
                  </div>
                </td>
              ))}
            </Disclosure.Button>
            <Transition
              as="tr"
              enter="transition duration-100 ease-out"
              enterFrom="transform scale-95 opacity-0"
              enterTo="transform scale-100 opacity-100"
              leave="transition duration-75 ease-out"
              leaveFrom="transform scale-100 opacity-100"
              leaveTo="transform scale-95 opacity-0"
              className={clsx(
                'border-x',
                open
                  ? ' !border-l-emerald-500 !border-r-neutral-500/40 shadow-xl '
                  : 'border-neutral-500/40'
              )}
            >
              <td
                colSpan={appFolder.envs.length + 1}
                className={clsx('p-2 space-y-6 bg-zinc-100 dark:bg-zinc-800')}
              >
                <Disclosure.Panel>
                  <div className="grid gap-2 divide-y divide-neutral-500/20">
                    {appFolder.envs.map((envFolder) => (
                      <EnvFolder key={envFolder.env.id} envFolder={envFolder} />
                    ))}
                  </div>
                </Disclosure.Panel>
              </td>
            </Transition>
          </>
        )}
      </Disclosure>
    )
  }

  return (
    <div className="max-h-screen overflow-y-auto w-full text-black dark:text-white grid gap-16 relative">
      {keyring !== null && (
        <section className="space-y-4 py-4">
          <div className="space-y-2">
            <div className="space-y-1">
              <h1 className="h3 font-semibold text-2xl">Environments</h1>
              {userCanReadEnvironments ? (
                <p className="text-neutral-500">
                  You have access to {data?.appEnvironments.length} Environments in this App.
                </p>
              ) : (
                <EmptyState
                  title="Access restricted"
                  subtitle="You don't have the permissions required to view Environments in this app."
                  graphic={
                    <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                      <FaBan />
                    </div>
                  }
                >
                  <></>
                </EmptyState>
              )}
            </div>
          </div>

          {data?.appEnvironments && (
            <Environments environments={data.appEnvironments} appId={params.app} />
          )}

          <hr className="border-neutral-500/40" />

          <div className="flex items-end justify-between">
            <div className="space-y-1">
              <h1 className="h3 font-semibold text-2xl">Secrets</h1>
              <p className="text-neutral-500">
                An overview of Secrets across all Environments in this App. Expand a row in the
                table below to compare and manage values across all Environments.
              </p>
            </div>
            <div className="flex items-center justify-end gap-4 p-4 text-neutral-500 text-xs whitespace-nowrap">
              <div className="flex items-center gap-1">
                <FaCheckCircle className="text-emerald-500 shrink-0" /> Secret is present
              </div>
              <div className="flex items-center gap-1">
                <FaCheckCircle className="text-amber-500 shrink-0" /> Secret is the same as
                Production
              </div>
              <div className="flex items-center gap-1">
                <FaCircle className="text-neutral-500 shrink-0" /> Secret is blank
              </div>
              <div className="flex items-center gap-1">
                <FaTimesCircle className="text-red-500 shrink-0" /> Secret is missing
              </div>
            </div>
          </div>

          <div className="flex items-center w-full justify-between border-b border-neutral-500/20 pb-4">
            <div className="relative flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md px-2">
              <div className="">
                <FaSearch className="text-neutral-500" />
              </div>
              <input
                placeholder="Search"
                className="custom bg-zinc-100 dark:bg-zinc-800"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <FaTimesCircle
                className={clsx(
                  'cursor-pointer text-neutral-500 transition-opacity ease',
                  searchQuery ? 'opacity-100' : 'opacity-0'
                )}
                role="button"
                onClick={() => setSearchQuery('')}
              />
            </div>

            <div className="flex flex-col items-end gap-4">
              <div className="flex gap-2 items-center">
                {unsavedChanges && (
                  <Button variant="outline" onClick={handleDiscardChanges} title="Discard changes">
                    <span className="px-2 py-1">
                      <FaUndo className="text-lg" />
                    </span>
                    <span>Discard changes</span>
                  </Button>
                )}

                {syncsData?.syncs && userCanReadSyncs && (
                  <div>
                    <EnvSyncStatus syncs={syncsData.syncs} team={params.team} app={params.app} />
                  </div>
                )}

                <Button
                  variant={unsavedChanges ? 'primary' : 'secondary'}
                  disabled={!unsavedChanges || savingAndFetching}
                  isLoading={savingAndFetching}
                  onClick={handleSaveChanges}
                >
                  <div className="flex items-center gap-2 text-lg">
                    {!savingAndFetching &&
                      (unsavedChanges ? (
                        <FaCloudUploadAlt className="text-emerald-500 shrink-0" />
                      ) : (
                        <FaCheckCircle className="text-emerald-500 shrink-0" />
                      ))}
                    <span>{unsavedChanges ? 'Deploy' : 'Deployed'}</span>
                  </div>
                </Button>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="primary" onClick={handleAddNewClientSecret}>
              <FaPlus /> New Secret
            </Button>
          </div>

          {clientAppSecrets.length > 0 || appFolders.length > 0 ? (
            <table className="table-auto w-full">
              <thead id="table-head" className="sticky top-0 z-10 border-b border-neutral-500/40">
                <tr>
                  <th className="pl-10 text-left text-sm font-medium text-gray-500 uppercase tracking-wide">
                    key
                  </th>
                  {data?.appEnvironments.map((env: EnvironmentType) => (
                    <th
                      key={env.id}
                      className="group text-center text-sm font-semibold uppercase tracking-widest py-2"
                    >
                      <Link href={`${pathname}/environments/${env.id}`}>
                        <Button variant="outline">
                          <div className="flex items-center gap-2 justify-center ">
                            {env.name}
                            <div className="opacity-30 group-hover:opacity-100 transform -translate-x-1 group-hover:translate-x-0 transition ease">
                              <FaArrowRight />
                            </div>
                          </div>
                        </Button>
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-500/40">
                {filteredFolders.map((appFolder) => (
                  <AppFolderRow key={appFolder.name} appFolder={appFolder} />
                ))}

                {filteredSecrets.map((appSecret, index) => (
                  <AppSecretRow
                    index={index}
                    key={appSecret.id}
                    clientAppSecret={appSecret}
                    serverAppSecret={serverSecret(appSecret.id)}
                    updateKey={handleUpdateSecretKey}
                    addEnvValue={handleAddNewEnvValue}
                    deleteEnvValue={stageEnvValueForDelete}
                    updateValue={handleUpdateSecretValue}
                    deleteKey={handleStageClientSecretForDelete}
                    stagedForDelete={appSecretsToDelete.includes(appSecret.id)}
                    secretsStagedForDelete={secretsToDelete}
                  />
                ))}
              </tbody>
            </table>
          ) : loading ? (
            <div className="w-full flex justify-center py-80">
              <Spinner size="xl" />
            </div>
          ) : userCanReadEnvironments && userCanReadSecrets ? (
            <div className="flex flex-col items-center py-10 border border-neutral-500/40 rounded-md bg-neutral-100 dark:bg-neutral-800">
              <EmptyState
                title="No secrets"
                subtitle="There are no secrets in this app yet. Click the button below to add a secret, or create one within a specific environment.
                secrets."
                graphic={
                  <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                    <FaBoxOpen />
                  </div>
                }
              >
                <div>
                  <Button variant="primary" onClick={handleAddNewClientSecret}>
                    <FaPlus /> New Secret
                  </Button>
                </div>
              </EmptyState>
            </div>
          ) : (
            <EmptyState
              title="Access restricted"
              subtitle="You don't have the permissions required to view Secrets in this app."
              graphic={
                <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                  <FaBan />
                </div>
              }
            >
              <></>
            </EmptyState>
          )}
        </section>
      )}
    </div>
  )
}
