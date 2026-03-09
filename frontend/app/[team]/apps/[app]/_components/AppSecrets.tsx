'use client'

import { BulkProcessSecrets } from '@/graphql/mutations/environments/bulkProcessSecrets.gql'
import { GetAppSyncStatus } from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import { GetAppDetail } from '@/graphql/queries/getAppDetail.gql'
import { useMutation, useQuery } from '@apollo/client'
import { useContext, useEffect, useRef, useState, useMemo, useCallback } from 'react'
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
  FaCloudUploadAlt,
  FaFolder,
  FaPlus,
  FaRegEye,
  FaSearch,
  FaTimesCircle,
  FaUndo,
} from 'react-icons/fa'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { organisationContext } from '@/contexts/organisationContext'
import { Button } from '@/components/common/Button'
import { Switch } from '@headlessui/react'
import clsx from 'clsx'
import { userHasPermission } from '@/utils/access/permissions'
import {
  digest,
  encryptAsymmetric,
  decryptAsymmetric,
  getUserKxPrivateKey,
  getUserKxPublicKey,
  arraysEqual,
} from '@/utils/crypto'
import { escapeRegExp } from 'lodash'
import { EmptyState } from '@/components/common/EmptyState'
import { toast } from 'react-toastify'
import { EnvSyncStatus } from '@/components/syncing/EnvSyncStatus'
import { useAppSecrets } from '../_hooks/useAppSecrets'
import { AppSecret } from '../types'
import { AppSecretRow } from './AppSecretRow'
import { SecretInfoLegend } from './SecretInfoLegend'
import { formatTitle } from '@/utils/meta'
import MultiEnvImportDialog from '@/components/environments/secrets/import/MultiEnvImportDialog'
import { TbDownload } from 'react-icons/tb'
import { duplicateKeysExist, normalizeKey } from '@/utils/secrets'
import { useWarnIfUnsavedChanges } from '@/hooks/warnUnsavedChanges'
import { AppDynamicSecretRow } from '@/ee/components/secrets/dynamic/AppDynamicSecretRow'
import { AppFolderRow } from './AppFolderRow'
import { AppSecretRowSkeleton } from './AppSecretRowSkeleton'

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

  const [revealOnHover, setRevealOnHover] = useState(false)

  const [searchQuery, setSearchQuery] = useState<string>('')

  const [bulkProcessSecrets, { loading: bulkUpdatePending }] = useMutation(BulkProcessSecrets)

  const [isLoading, setIsLoading] = useState(false)

  const importDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

  const savingAndFetching = bulkUpdatePending || isLoading

  const { keyring } = useContext(KeyringContext)

  const normalizeValues = (values: (string | undefined)[]) => values.map((value) => value ?? null) // Replace undefined with null for consistent comparison

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

  useWarnIfUnsavedChanges(unsavedChanges)

  const { appEnvironments, appSecrets, appFolders, appDynamicSecrets, fetching, refetch } =
    useAppSecrets(
      app,
      userCanReadSecrets,
      unsavedChanges ? 0 : 10000 // Poll every 10 seconds
    )

  const filteredFolders = useMemo(() => {
    if (searchQuery === '') return appFolders
    const re = new RegExp(escapeRegExp(searchQuery), 'i')
    return appFolders.filter((folder) => re.test(folder.name))
  }, [appFolders, searchQuery])

  const handleExpandRow = useCallback((secretId: string) => {
    setExpandedSecrets((prev) => (prev.includes(secretId) ? prev : [...prev, secretId]))
  }, [])

  const handleCollapseRow = useCallback((secretId: string) => {
    setExpandedSecrets((prev) => prev.filter((id) => id !== secretId))
  }, [])

  const handleUpdateSecretKey = useCallback((id: string, key: string) => {
    setClientAppSecrets((prev) => prev.map((s) => (s.id === id ? { ...s, key } : s)))
  }, [])

  const handleUpdateSecretValue = useCallback(
    (id: string, envId: string, value: string | undefined) => {
      setClientAppSecrets((prev) =>
        prev.map((secret) => {
          if (secret.id !== id) return secret
          const envs = secret.envs.map((env) => {
            if (env.env.id !== envId || !env.secret) return env
            if (value === null || value === undefined) return env
            return { ...env, secret: { ...env.secret, value } }
          })
          return { ...secret, envs }
        })
      )
    },
    []
  )

  const allRowsAreCollapsed = expandedSecrets.length === 0

  const allRowsAreExpanded = [...clientAppSecrets, ...appDynamicSecrets].every((item) =>
    expandedSecrets.includes(item.id)
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
          const searchRegex = new RegExp(escapeRegExp(searchQuery), 'i')
          const valueMatch = secret.envs.some(
            (env) => env.secret && searchRegex.test(env.secret.value)
          )
          return searchRegex.test(secret.key) || valueMatch
        })

  const filteredDynamicSecrets =
    searchQuery === ''
      ? appDynamicSecrets
      : appDynamicSecrets.filter((secret) => {
          const searchRegex = new RegExp(escapeRegExp(searchQuery), 'i')
          return searchRegex.test(secret.name)
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
      ? setExpandedSecrets([
          ...clientAppSecrets.map((appSecret) => appSecret.id),
          ...appDynamicSecrets.map((appDynamicSecret) => appDynamicSecret.id),
        ])
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

  const handleAddNewClientSecret = (initialKey?: string) => {
    const keyToUse = initialKey ?? ''
    const envs: EnvironmentType[] = appEnvironments

    setClientAppSecrets([
      {
        id: crypto.randomUUID(),
        key: keyToUse,
        envs: envs.map((environment) => {
          return {
            env: environment,
            secret: {
              id: `new-${crypto.randomUUID()}`,
              updatedAt: null,
              version: 1,
              key: keyToUse,
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

  const handleCreateSecretFromSearch = () => {
    const normalizedKey = normalizeKey(searchQuery)
    handleAddNewClientSecret(normalizedKey)
    setSearchQuery('')
  }

  /**
   * Bulk adds or updates client secrets in state from an import.
   *
   * For each secret in `newSecrets`:
   * - If the secret key already exists, update each environment value if it differs.
   *   - If the environment exists but has no secret yet, initialize it.
   *   - If it exists and already has a secret, overwrite its value/comment.
   *   - If the environment does not exist, add it.
   * - If the secret key does not exist at all, add it as a new secret.
   *
   *
   * @param {AppSecret[]} newSecrets - Secrets being imported into client state
   */
  function bulkAddNewClientSecrets(newSecrets: AppSecret[]) {
    setClientAppSecrets((prev) => {
      // Clone all existing secrets so we work on new objects,
      // avoiding in-place mutations of previous state.
      const existingMap = new Map(prev.map((s) => [s.key, structuredClone(s)]))

      newSecrets.forEach((ns) => {
        const existing = existingMap.get(ns.key)

        if (existing) {
          // This secret key already exists, update environments as needed
          ns.envs.forEach(({ env, secret }) => {
            // Find matching environment in existing secret
            const match = existing.envs.find((e) => e.env.id === env.id)

            if (secret && match && !match.secret) {
              // Environment exists but has no secret yet → initialize it
              match.secret = {
                id: `new-${crypto.randomUUID()}`,
                updatedAt: null,
                version: 1,
                key: '',
                value: secret.value,
                tags: [],
                comment: secret.comment,
                path: '/',
                environment: env as EnvironmentType,
              }
            } else if (match && secret) {
              // Environment already has a secret → overwrite value and comment
              match.secret = {
                ...match.secret,
                value: secret.value,
                comment: secret.comment,
              } as SecretType
            }
          })
        } else {
          // This secret key does not exist at all → add as new secret
          existingMap.set(ns.key, structuredClone(ns))
        }
      })

      return Array.from(existingMap.values())
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
    setClientAppSecrets((prev) => {
      const idx = prev.findIndex((s) => s.id === appSecretId)
      if (idx === -1) return prev
      const secret = prev[idx]

      const serverSecretForKey = serverAppSecrets.find((s) => s.id === appSecretId)
      const serverEnvValue = serverSecretForKey?.envs.find(
        (e) => e.env.id === environment.id
      )?.secret
      const clientEnvEntry = secret.envs.find((e) => e.env.id === environment.id)

      // Client-only value → null it locally
      if (!serverEnvValue || serverEnvValue.value == null) {
        if (!clientEnvEntry || clientEnvEntry.secret === null) return prev
        const newEnvs = secret.envs.map((envEntry) =>
          envEntry.env.id === environment.id ? { ...envEntry, secret: null } : envEntry
        )
        const hasAnyValue = newEnvs.some((e) => e.secret !== null)
        const next = prev.slice()
        if (!hasAnyValue) {
          // Directly stage whole secret for delete here
          setAppSecretsToDelete((list) =>
            list.includes(appSecretId) ? list : [...list, appSecretId]
          )
          // Add all server-side env secret ids (excluding new-)
          setSecretsToDelete((ids) => [
            ...ids,
            ...secret.envs
              .map((e) => e.secret?.id)
              .filter((sid): sid is string => !!sid && !sid.startsWith('new-')),
          ])
          // Remove entire secret from client list
          next.splice(idx, 1)
          return next
        } else {
          next[idx] = { ...secret, envs: newEnvs }
          return next
        }
      }

      // Server value exists → toggle staged flag
      if (!clientEnvEntry || !clientEnvEntry.secret) return prev
      const targetId = clientEnvEntry.secret.id
      const willStage = !secretsToDelete.includes(targetId)

      setSecretsToDelete((prevIds) =>
        willStage ? [...prevIds, targetId] : prevIds.filter((x) => x !== targetId)
      )

      const newEnvs = secret.envs.map((envEntry) =>
        envEntry.env.id === environment.id
          ? {
              ...envEntry,
              secret: {
                ...envEntry.secret!,
                stagedForDelete: willStage,
              },
            }
          : envEntry
      )

      const next = prev.slice()
      next[idx] = { ...secret, envs: newEnvs }
      return next
    })
  }

  /**
   * Handles the delete action for an appSecret. If the secret exists on the server, it is queued for delete, else it delete instantly from local state.
   *
   * @param {string} id
   * @returns {void}
   */
  const handleStageClientSecretForDelete = (id: string) => {
    setClientAppSecrets((prev) => {
      const idx = prev.findIndex((s) => s.id === id)
      if (idx === -1) return prev
      const secret = prev[idx]
      const isMarked = appSecretsToDelete.includes(id)

      if (isMarked) {
        // Restore from server
        const server = serverAppSecrets.find((s) => s.id === id)
        if (!server) return prev
        const restored: AppSecret = {
          ...secret,
          envs: server.envs.map((e) => ({ ...e })), // clone env entries
        }
        const next = prev.slice()
        next[idx] = restored
        setAppSecretsToDelete((list) => list.filter((x) => x !== id))
        setSecretsToDelete((ids) =>
          ids.filter((sid) => !server.envs.some((e) => e.secret?.id === sid))
        )
        return next
      } else {
        // Remove client-only env secrets (new-*)
        const keptEnvs = secret.envs.filter((e) => !e.secret?.id?.startsWith('new-'))
        if (keptEnvs.length === 0) {
          // Remove entire secret
          const next = prev.slice()
          next.splice(idx, 1)
          setAppSecretsToDelete((list) => [...list, id])
          setSecretsToDelete((ids) => [
            ...ids,
            ...secret.envs
              .map((e) => e.secret?.id)
              .filter((sid): sid is string => !!sid && !sid.startsWith('new-')),
          ])
          return next
        }
        const updated: AppSecret = { ...secret, envs: keptEnvs.map((e) => ({ ...e })) }
        const next = prev.slice()
        next[idx] = updated
        setAppSecretsToDelete((list) => [...list, id])
        setSecretsToDelete((ids) => [
          ...ids,
          ...secret.envs
            .map((e) => e.secret?.id)
            .filter((sid): sid is string => !!sid && !sid.startsWith('new-')),
        ])
        return next
      }
    })
  }

  const handleDiscardChanges = () => {
    setClientAppSecrets(serverAppSecrets)
    setSecretsToDelete([])
    setAppSecretsToDelete([])
  }

  type EnvFolderProp = {
    envFolder: { env: Partial<EnvironmentType>; folder: SecretFolderType | null }
    pathname: string
  }

  const EnvFolderBase = ({ envFolder, pathname }: EnvFolderProp) => {
    const fullPath = `${envFolder.folder?.path}/${envFolder.folder?.name}`.replace(/^\/+/, '')
    return (
      <div className="py-2 px-4">
        {envFolder.folder === null ? (
          <span className="text-red-500 font-mono">missing</span>
        ) : (
          <Link
            className="flex items-center gap-2  group font-medium text-sm tracking-wider"
            href={`${pathname}/environments/${envFolder.env.id}${envFolder.folder ? `/${fullPath}` : ``}`}
            title={
              envFolder.folder
                ? `View this folder in ${envFolder.env.name}`
                : `Manage ${envFolder.env.name}`
            }
          >
            <div>
              <div className="text-gray-500">{envFolder.env.name}</div>
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

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between">
        <div className="space-y-1">
          <h1 className="h3 font-semibold text-xl" id="secrets">
            Secrets
          </h1>
          <p className="text-neutral-500 text-sm">
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
            placeholder="Search keys or values"
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

      {(filteredSecrets.length > 0 || filteredDynamicSecrets.length > 0) && (
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

            <label className="flex items-center gap-2 pl-2 border-l border-neutral-500/20 cursor-pointer select-none">
              <Switch
                checked={revealOnHover}
                onChange={setRevealOnHover}
                className={clsx(
                  revealOnHover
                    ? 'bg-emerald-400/10 ring-emerald-400/20'
                    : 'bg-neutral-500/40 ring-neutral-500/30',
                  'relative inline-flex h-6 w-11 items-center rounded-full ring-1 ring-inset transition-colors'
                )}
              >
                <span
                  className={clsx(
                    revealOnHover ? 'translate-x-6 bg-emerald-400' : 'translate-x-1 bg-neutral-500',
                    'inline-block h-4 w-4 transform rounded-full transition-transform'
                  )}
                />
              </Switch>
              <span className="flex items-center gap-1.5 text-sm text-neutral-500">
                <FaRegEye className={revealOnHover ? 'text-emerald-500' : ''} />
                Reveal on hover
              </span>
            </label>
          </div>
          <div className="flex justify-end pr-4 gap-4">
            <Button variant="secondary" onClick={() => importDialogRef.current?.openModal()}>
              <TbDownload /> Import secrets
            </Button>
            {userCanCreateSecrets && (
              <Button variant="primary" onClick={() => handleAddNewClientSecret()}>
                <FaPlus /> New Secret
              </Button>
            )}
          </div>
        </div>
      )}

      {clientAppSecrets.length > 0 || appFolders.length > 0 || searchQuery ? (
        <>
          {filteredSecrets.length > 0 || filteredFolders.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full table-auto  w-full">
                <thead
                  id="table-head"
                  className="sticky top-0 z-10 dark:bg-zinc-900/50 backdrop-blur-sm"
                >
                  <tr>
                    <th className="pl-10 text-left text-2xs 2xl:text-sm font-medium text-gray-500 uppercase tracking-wide">
                      key
                    </th>
                    {appEnvironments?.map((env: EnvironmentType) => (
                      <th
                        key={env.id}
                        className="group text-center text-2xs 2xl:text-sm font-semibold uppercase p-2 w-px whitespace-nowrap"
                      >
                        <Link href={`${pathname}/environments/${env.id}`}>
                          <Button variant="outline">
                            <div className="items-center gap-2 justify-center hidden 2xl:flex">
                              {env.name}
                              <div className="opacity-30 group-hover:opacity-100 transform -translate-x-1 group-hover:translate-x-0 transition ease">
                                <FaArrowRight />
                              </div>
                            </div>
                            <div title={env.name} className="block 2xl:hidden text-2xs">
                              {env.name.slice(0, 1)}
                            </div>
                          </Button>
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-500/20 rounded-md">
                  {filteredFolders.map((appFolder) => (
                    <AppFolderRow
                      key={`${appFolder.path}/${appFolder.name}`}
                      appFolder={appFolder}
                      pathname={pathname || ''}
                    />
                  ))}

                  {filteredDynamicSecrets.map((appDynamicSecret) => (
                    <AppDynamicSecretRow
                      key={appDynamicSecret.id}
                      appDynamicSecret={appDynamicSecret}
                      isExpanded={expandedSecrets.includes(appDynamicSecret.id)}
                      expand={handleExpandRow}
                      collapse={handleCollapseRow}
                    />
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
                      revealOnHover={revealOnHover}
                    />
                  ))}
                </tbody>
              </table>
            </div>
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
                {userCanCreateSecrets && (
                  <div className="mt-4">
                    <Button variant="primary" onClick={handleCreateSecretFromSearch}>
                      <FaPlus /> Create &quot;{normalizeKey(searchQuery)}&quot;
                    </Button>
                  </div>
                )}
              </EmptyState>
            </div>
          )}
          <SecretInfoLegend />
        </>
      ) : isLoading || fetching || (appSecrets?.length > 0 && clientAppSecrets.length === 0) ? (
        <div className="overflow-x-auto">
          <table className="min-w-full table-auto w-full">
            <thead
              id="table-head"
              className="sticky top-0 z-10 dark:bg-zinc-900/50 backdrop-blur-sm"
            >
              <tr>
                <th className="pl-10 text-left text-2xs 2xl:text-sm font-medium text-gray-500 uppercase tracking-wide">
                  key
                </th>
                {['Development', 'Staging', 'Production'].map((envName) => (
                  <th
                    key={envName}
                    className="group text-center text-2xs 2xl:text-sm font-semibold uppercase tracking-widest py-2"
                  >
                    <Button variant="outline">
                      <div className="items-center gap-2 justify-center hidden 2xl:flex">
                        {envName}
                        <div className="opacity-30">
                          <FaArrowRight />
                        </div>
                      </div>
                      <div title={envName} className="block 2xl:hidden text-2xs">
                        {envName.slice(0, 1)}
                      </div>
                    </Button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-500/20 rounded-md">
              {[...Array(13)].map((_, index) => (
                <AppSecretRowSkeleton key={`skeleton-${index}`} index={index} envCount={3} />
              ))}
            </tbody>
          </table>
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
              <Button variant="primary" onClick={() => handleAddNewClientSecret()}>
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
