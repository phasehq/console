'use client'

import { InitAppEnvironments } from '@/graphql/mutations/environments/initAppEnvironments.gql'
import { BulkProcessSecrets } from '@/graphql/mutations/environments/bulkProcessSecrets.gql'
import { GetAppSyncStatus } from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import { GetAppDetail } from '@/graphql/queries/getAppDetail.gql'
import { useMutation, useQuery } from '@apollo/client'
import { useContext, useEffect, useRef, useState } from 'react'
import { EnvironmentType, SecretFolderType, SecretInput, SecretType } from '@/apollo/graphql'
import _sodium from 'libsodium-wrappers-sumo'
import { KeyringContext } from '@/contexts/keyringContext'
import { MdPassword, MdSearchOff } from 'react-icons/md'

import {
  FaAngleDoubleDown,
  FaAngleDoubleUp,
  FaArrowRight,
  FaBan,
  FaCheckCircle,
  FaChevronRight,
  FaCloudUploadAlt,
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
import {
  digest,
  encryptAsymmetric,
  decryptAsymmetric,
  getUserKxPrivateKey,
  getUserKxPublicKey,
  arraysEqual,
} from '@/utils/crypto'

import { EmptyState } from '@/components/common/EmptyState'

import { toast } from 'react-toastify'
import { EnvSyncStatus } from '@/components/syncing/EnvSyncStatus'
import { useAppSecrets } from '../_hooks/useAppSecrets'
import { AppSecret, AppFolder } from '../types'
import { AppSecretRow } from './AppSecretRow'
import { SecretInfoLegend } from './SecretInfoLegend'
import { formatTitle } from '@/utils/meta'
import MultiEnvImportDialog from '@/components/environments/secrets/import/MultiEnvImportDialog'
import { TbDownload } from 'react-icons/tb'
import { duplicateKeysExist } from '@/utils/secrets'

export const AppSecrets = ({ team, app }: { team: string; app: string }) => {
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
  const userCanCreateSecrets = userHasPermission(
    organisation?.role?.permissions,
    'Secrets',
    'create',
    true
  )
  const userCanReadSyncs = userHasPermission(
    organisation?.role?.permissions,
    'Integrations',
    'read',
    true
  )

  const { data } = useQuery(GetAppDetail, {
    variables: { organisationId: organisation?.id, appId: app },
    skip: !organisation,
  })

  useEffect(() => {
    if (data?.apps?.[0]?.name) {
      const appName = data.apps[0].name
      document.title = formatTitle(`${appName} Secrets`)
    }
  }, [data])

  const pathname = usePathname()

  const [serverAppSecrets, setServerAppSecrets] = useState<AppSecret[]>([])
  const [clientAppSecrets, setClientAppSecrets] = useState<AppSecret[]>([])
  const [secretsToDelete, setSecretsToDelete] = useState<string[]>([])
  const [appSecretsToDelete, setAppSecretsToDelete] = useState<string[]>([])

  const [expandedSecrets, setExpandedSecrets] = useState<string[]>([])

  const [searchQuery, setSearchQuery] = useState<string>('')
  const [initAppEnvironments] = useMutation(InitAppEnvironments)
  const [bulkProcessSecrets, { loading: bulkUpdatePending }] = useMutation(BulkProcessSecrets)

  const [isLoading, setIsLoading] = useState(false)

  const importDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

  const savingAndFetching = bulkUpdatePending || isLoading

  const { keyring } = useContext(KeyringContext)

  const normalizeValues = (values: (string | undefined)[]) => values.map((value) => value ?? null) // Replace undefined with null for consistent comparison

  const handleExpandRow = (secretId: string) => {
    if (!expandedSecrets.includes(secretId)) setExpandedSecrets([...expandedSecrets, secretId])
  }

  const handleCollapseRow = (secretId: string) => {
    setExpandedSecrets(expandedSecrets.filter((id) => id !== secretId))
  }

  const allRowsAreExpanded = clientAppSecrets.every((secret) => expandedSecrets.includes(secret.id))
  const allRowsAreCollapsed = expandedSecrets.length === 0

  const unsavedChanges =
    // Check if any secrets are staged for delete
    secretsToDelete.length > 0 ||
    // Check if any new secret keys are added
    !arraysEqual(
      clientAppSecrets.map((appSecret) => appSecret.key),
      serverAppSecrets.map((appSecret) => appSecret.key)
    ) ||
    // Check if values are modified for existing secrets
    serverAppSecrets.some((appSecret) => {
      const clientSecret = clientAppSecrets.find(
        (clientAppSecret) => clientAppSecret.id === appSecret.id
      )

      if (!clientSecret) return true // Secret is missing in client (potential deletion)

      return !arraysEqual(
        normalizeValues(appSecret.envs.map((env) => env.secret?.value)),
        normalizeValues(clientSecret.envs.map((env) => env.secret?.value))
      )
    })

  const { appEnvironments, appSecrets, appFolders, fetching, refetch } = useAppSecrets(
    app,
    userCanReadSecrets,
    unsavedChanges ? 0 : 10000 // Poll every 10 seconds
  )

  useEffect(() => {
    if (appSecrets) {
      setServerAppSecrets(appSecrets)
      setClientAppSecrets(appSecrets)
    }
  }, [appSecrets])

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
      appId: app,
    },
    skip: !userCanReadSyncs,
    pollInterval: unsavedChanges ? 0 : 5000,
  })

  const toggleAllExpanded = (expand: boolean) => {
    expand
      ? setExpandedSecrets(clientAppSecrets.map((appSecret) => appSecret.id))
      : setExpandedSecrets([])
  }

  const serverSecret = (id: string) => serverAppSecrets.find((secret) => secret.id === id)

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
          clientSecret.environment.wrappedSalt!,
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
              appId: app,
            },
          },
        ],
      })

      if (!errors) {
        setSecretsToDelete([])
        setAppSecretsToDelete([])
      }

      await refetch()
      setServerAppSecrets(appSecrets)
      setClientAppSecrets(appSecrets)
    }
  }

  // Wraps handleBulkUpdateSecrets with some basic validation checks, loading state updates and toasts
  const handleSaveChanges = async () => {
    setIsLoading(true)

    if (blankKeysExist()) {
      toast.error('Secret keys cannot be empty!')
      setIsLoading(false)
      return false
    }

    if (duplicateKeysExist(clientAppSecrets)) {
      toast.error('Secret keys cannot be repeated!')
      setIsLoading(false)
      return false
    }

    await handleBulkUpdateSecrets()

    setIsLoading(false)

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
    const envs: EnvironmentType[] = appEnvironments

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

  const bulkAddNewClientSecrets = (newSecrets: AppSecret[]) => {
    setClientAppSecrets((prevSecrets) => {
      const updatedSecrets = [...newSecrets, ...prevSecrets]
      return updatedSecrets
    })
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

          const updatedEnvs = appSecret.envs.map((env) => {
            if (env.env.id === environment.id) {
              return {
                ...env,
                secret: newSecret,
              }
            }
            return env
          })

          return {
            ...appSecret,
            envs: updatedEnvs,
          }
        }
        return appSecret
      })
    )
  }

  /**
   * Handles the delete action for a specific environment's value, for a given appSecret key
   *
   *
   * @param {string} appSecretId
   * @param {EnvironmentType} environment
   */
  const stageEnvValueForDelete = (appSecretId: string, environment: EnvironmentType) => {
    //Find the app secret and env value in local state
    const appSecret = clientAppSecrets.find((appSecret) => appSecret.id === appSecretId)
    const secretToDelete = appSecret?.envs.find((env) => env.env.id === environment.id)

    if (secretToDelete) {
      // Try and find the correspding values on the server
      const serverAppSecret = serverAppSecrets.find((appSecret) => appSecret.id === appSecretId)
      const envValueOnServer = serverAppSecret?.envs.find((env) => env.env.id === environment.id)

      // Check if the value is null or undefined, which means that the value is not on server, and has been created client-side but not yet saved.
      if (
        envValueOnServer?.secret?.value === null ||
        envValueOnServer?.secret?.value === undefined
      ) {
        // Update the local state to for this appSecret by setting the env value to null
        setClientAppSecrets((prevSecrets) =>
          prevSecrets.map((prevSecret) => {
            if (prevSecret.id === appSecretId) {
              const { id, key, envs } = prevSecret

              const updatedEnvs = envs.filter((env) => {
                if (env.env.id === environment.id) {
                  env!.secret = null
                }

                return env
              })

              const hasNonNullValue = updatedEnvs.some((env) => env?.secret !== null)

              if (!hasNonNullValue) {
                handleStageClientSecretForDelete(appSecretId)
              }

              return {
                id,
                key,
                envs: envs.filter((env) => {
                  if (env.env.id === environment.id) {
                    env!.secret = null
                  }

                  return env
                }),
              }
            }

            return prevSecret
          })
        )
      }
      // The value exists on the server, and must be qeued for a server delete
      else {
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
  }

  /**
   * Handles the delete action for an appSecret. If the secret exists on the server, it is queued for delete, else it delete instantly from local state.
   *
   * @param {string} id
   * @returns {void}
   */
  const handleStageClientSecretForDelete = (id: string) => {
    const toggleDelete = (appSecret: AppSecret | undefined): AppSecret | null => {
      if (!appSecret) return null

      const isMarkedForDelete = appSecretsToDelete.includes(id)

      if (isMarkedForDelete) {
        // Restore secret by rehydrating from server state
        const serverSecret = serverAppSecrets.find((s) => s.id === id)
        return serverSecret ? { ...appSecret, envs: serverSecret.envs } : appSecret
      } else {
        // Filter out client-only secrets
        const updatedEnvs = appSecret.envs.filter((env) => !env.secret?.id?.includes('new'))

        // Remove the appSecret if no envs remain
        return updatedEnvs.length > 0 ? { ...appSecret, envs: updatedEnvs } : null
      }
    }

    const updateSecretsToDelete = (): string[] => {
      const isMarkedForDelete = appSecretsToDelete.includes(id)
      if (isMarkedForDelete) {
        // Remove secret IDs from deletion list
        const serverSecretIds = getServerSecretIds(id)
        return secretsToDelete.filter((secretId) => !serverSecretIds.includes(secretId))
      } else {
        // Add server-secret IDs to deletion list
        const appSecret = clientAppSecrets.find((s) => s.id === id)
        if (!appSecret) return secretsToDelete
        const serverSecretIds = getServerSecretIdsFromAppSecret(appSecret)
        return [...secretsToDelete, ...serverSecretIds]
      }
    }

    const updateAppSecretsToDelete = (): string[] => {
      const isMarkedForDelete = appSecretsToDelete.includes(id)
      return isMarkedForDelete
        ? appSecretsToDelete.filter((secretId) => secretId !== id)
        : [...appSecretsToDelete, id]
    }

    const getServerSecretIds = (id: string): string[] => {
      const serverSecret = serverAppSecrets.find((s) => s.id === id)
      return serverSecret
        ? serverSecret.envs
            .map((env) => env.secret?.id)
            .filter((id): id is string => id !== undefined)
        : []
    }

    const getServerSecretIdsFromAppSecret = (appSecret: AppSecret): string[] => {
      return appSecret.envs
        .map((env) => env.secret?.id)
        .filter((id) => id && !id.includes('new')) as string[]
    }

    // Update state
    setClientAppSecrets(
      (prevSecrets) =>
        prevSecrets
          .map((appSecret) => (appSecret.id === id ? toggleDelete(appSecret) : appSecret))
          .filter(Boolean) as AppSecret[]
    )

    setSecretsToDelete(updateSecretsToDelete())
    setAppSecretsToDelete(updateAppSecretsToDelete())
  }

  const handleDiscardChanges = () => {
    setClientAppSecrets(serverAppSecrets)
    setSecretsToDelete([])
    setAppSecretsToDelete([])
  }

  const EnvFolder = (props: {
    envFolder: {
      env: Partial<EnvironmentType>
      folder: SecretFolderType | null
    }
  }) => {
    const { envFolder } = props

    const fullPath = `${envFolder.folder?.path}/${envFolder.folder?.name}`.replace(/^\/+/, '')

    return (
      <div className="py-2 px-4">
        {envFolder.folder === null ? (
          <span className="text-red-500 font-mono">missing</span>
        ) : (
          <Link
            className="flex items-center gap-2  group font-medium text-sm tracking-wider"
            href={`${pathname}/environments/${envFolder.env.id}${
              envFolder.folder ? `/${fullPath}` : ``
            }`}
            title={
              envFolder.folder
                ? `View this folder in ${envFolder.env.name}`
                : `Manage ${envFolder.env.name}`
            }
          >
            <div>
              <div className="text-gray-500">{envFolder.env.name}</div>{' '}
              <div className="text-emerald-500 group-hover:text-emerald-600 transition ease flex items-center gap-2">
                <FaFolder />
                {fullPath}
              </div>
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
      if (env.folder === null) return `This folder is missing in ${env.env.name}`
      else return 'This folder is present'
    }

    const fullPath = `${appFolder.path}/${appFolder.name}`.replace(/^\/+/, '')

    return (
      <Disclosure>
        {({ open }) => (
          <>
            <Disclosure.Button
              as="tr"
              className={clsx(
                'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700/80 group divide-x divide-neutral-500/40 border-x transition ease duration-100 cursor-pointer',
                open ? ' !border-l-emerald-500 !border-r-neutral-500/20' : '  border-neutral-500/20'
              )}
            >
              <td
                className={clsx(
                  'px-6 py-3 whitespace-nowrap font-mono text-zinc-800 dark:text-zinc-300 flex items-center gap-2 ph-no-capture',
                  open ? 'font-bold' : 'font-medium'
                )}
              >
                <FaFolder className="text-emerald-500" />

                {fullPath}
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
    <section className="space-y-4 py-4">
      <div className="flex items-end justify-between">
        <div className="space-y-1">
          <h1 className="h3 font-semibold text-2xl">Secrets</h1>
          <p className="text-neutral-500">
            An overview of Secrets across all Environments in this App. Expand a row in the table
            below to compare and manage values across all Environments.
          </p>
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

        <div className="flex flex-col items-end gap-4 pr-4">
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
                <EnvSyncStatus syncs={syncsData.syncs} team={team} app={app} />
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

      {appEnvironments && (
        <MultiEnvImportDialog
          environments={appEnvironments}
          addSecrets={bulkAddNewClientSecrets}
          ref={importDialogRef}
        />
      )}

      {filteredSecrets.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="secondary"
              disabled={allRowsAreExpanded}
              onClick={() => toggleAllExpanded(true)}
            >
              <FaAngleDoubleDown /> Expand all
            </Button>

            <Button
              variant="secondary"
              disabled={allRowsAreCollapsed}
              onClick={() => toggleAllExpanded(false)}
            >
              <FaAngleDoubleUp />
              Collapse all
            </Button>
          </div>
          <div className="flex justify-end pr-4 gap-4">
            <Button variant="secondary" onClick={() => importDialogRef.current?.openModal()}>
              <TbDownload /> Import secrets
            </Button>
            {userCanCreateSecrets && (
              <Button variant="primary" onClick={handleAddNewClientSecret}>
                <FaPlus /> New Secret
              </Button>
            )}
          </div>
        </div>
      )}

      {clientAppSecrets.length > 0 || appFolders.length > 0 ? (
        <>
          {filteredSecrets.length > 0 || filteredFolders.length > 0 ? (
            <table className="table-auto w-full">
              <thead
                id="table-head"
                className="sticky top-0 z-10 dark:bg-zinc-900/50 backdrop-blur-sm"
              >
                <tr>
                  <th className="pl-10 text-left text-sm font-medium text-gray-500 uppercase tracking-wide">
                    key
                  </th>
                  {appEnvironments?.map((env: EnvironmentType) => (
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
              <tbody className="divide-y divide-neutral-500/20 rounded-md">
                {filteredFolders.map((appFolder) => (
                  <AppFolderRow key={appFolder.name} appFolder={appFolder} />
                ))}

                {filteredSecrets.map((appSecret, index) => (
                  <AppSecretRow
                    index={index}
                    isExpanded={expandedSecrets.includes(appSecret.id)}
                    expand={handleExpandRow}
                    collapse={handleCollapseRow}
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
                    rowTabIndexBase={index * 100}
                    onExpandNextSecret={() => {
                      // Check if there's a next secret to expand
                      if (index < filteredSecrets.length - 1) {
                        const nextSecret = filteredSecrets[index + 1];
                        handleExpandRow(nextSecret.id);
                        
                        // If we're expanding a new row, scroll it into view
                        setTimeout(() => {
                          const element = document.getElementById(`secret-key-${nextSecret.id}`);
                          if (element) {
                            element.focus();
                            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                          }
                        }, 10);
                      }
                    }}
                  />
                ))}
              </tbody>
            </table>
          ) : (
            <div className="flex flex-col items-center py-10 border border-neutral-500/40 rounded-md bg-neutral-100 dark:bg-neutral-800">
              <EmptyState
                title={`No results for "${searchQuery}"`}
                subtitle="Try adjusting your search term"
                graphic={
                  <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                    <MdSearchOff />
                  </div>
                }
              >
                <></>
              </EmptyState>
            </div>
          )}
          <SecretInfoLegend />
        </>
      ) : isLoading || fetching ? (
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
                <MdPassword />
              </div>
            }
          >
            <div className="flex items-center gap-4">
              <Button variant="outline" onClick={() => importDialogRef.current?.openModal()}>
                <TbDownload /> Import secrets
              </Button>
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
  )
}
