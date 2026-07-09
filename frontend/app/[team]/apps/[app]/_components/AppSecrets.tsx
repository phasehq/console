'use client'

import { BulkProcessSecrets } from '@/graphql/mutations/environments/bulkProcessSecrets.gql'
import { CreateNewSecretFolder } from '@/graphql/mutations/environments/createFolder.gql'
import { GetAppSyncStatus } from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import { GetAppDetail } from '@/graphql/queries/getAppDetail.gql'
import { useMutation, useQuery } from '@apollo/client'
import { useContext, useEffect, useRef, useState, useMemo, useCallback } from 'react'
import {
  ApiSecretTypeChoices,
  EnvironmentType,
  SecretInput,
  SecretTagType,
  SecretType,
} from '@/apollo/graphql'
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
  FaFolderPlus,
  FaPlus,
  FaRegEye,
  FaSearch,
  FaTimesCircle,
  FaUndo,
} from 'react-icons/fa'
import Link from 'next/link'
import { organisationContext } from '@/contexts/organisationContext'
import { Button } from '@/components/common/Button'
import { SplitButton } from '@/components/common/SplitButton'
import { Input } from '@/components/common/Input'
import GenericDialog from '@/components/common/GenericDialog'
import { Switch } from '@headlessui/react'
import clsx from 'clsx'
import { useAppPermissions } from '@/hooks/useAppPermissions'
import {
  digest,
  encryptAsymmetric,
  decryptAsymmetric,
  getUserKxPrivateKey,
  getUserKxPublicKey,
  arraysEqual,
} from '@/utils/crypto'
import { areTagsAreSame } from '@/utils/tags'
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
import {
  duplicateKeysExist,
  getSavedSort,
  isReservedFolderName,
  normalizeKey,
  saveSort,
  SortOption,
  sortAppSecrets,
} from '@/utils/secrets'
import { useWarnIfUnsavedChanges } from '@/hooks/warnUnsavedChanges'
import { PathBreadcrumbs } from '@/components/environments/secrets/PathBreadcrumbs'
import { DeployPreview } from '@/components/environments/secrets/DeployPreview'
import { useEnvSelection } from './EnvSelectionProvider'

// Flattens AppSecret[] into one SecretType per env value, with the key-level
// key applied and the environment attached.
const flattenAppSecrets = (appSecrets: AppSecret[]): SecretType[] =>
  appSecrets.flatMap((appSecret) =>
    appSecret.envs
      .filter((env) => env.secret !== null)
      .map((env) => ({
        ...env.secret!,
        key: appSecret.key,
        environment: env.env as EnvironmentType,
      }))
  )
import { AppDynamicSecretGroup } from './AppDynamicSecretGroup'
import { AppDynamicSecretKeyRow } from './AppDynamicSecretKeyRow'
import { AppFolderRow } from './AppFolderRow'
import { AppRotatingSecretGroup } from './AppRotatingSecretGroup'
import { AppSecretRowSkeleton } from './AppSecretRowSkeleton'
import { GetRotatingSecrets } from '@/graphql/queries/secrets/rotation/getRotatingSecrets.gql'
import { RotatingSecretType } from '@/apollo/graphql'
import SortMenu from '@/components/environments/secrets/SortMenu'
import { SecretReferenceContext } from '@/contexts/secretReferenceContext'
import {
  validateSecretReferences,
  ReferenceContext,
  ReferenceValidationError,
} from '@/utils/secretReferences'
import { BrokenReferencesDialog } from '@/components/secrets/BrokenReferencesDialog'
import { useOrgSecretKeys } from '@/hooks/useOrgSecretKeys'

export const AppSecrets = ({
  team,
  app,
  pathSegments = [],
}: {
  team: string
  app: string
  pathSegments?: string[]
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  // Folder path shared with the single-env editors via the route
  const secretPath = pathSegments.length > 0 ? `/${pathSegments.join('/')}` : '/'
  const basePath = `/${team}/apps/${app}`
  const pathSuffix = secretPath === '/' ? '' : secretPath

  // Permissions
  const { hasPermission } = useAppPermissions(app)

  // Computed once here and passed down as props — useAppPermissions runs a
  // GetTeams query and JSON-parses role policies per hasPermission call, far
  // too heavy to invoke in every row / env value editor.
  const userCanReadEnvironments = hasPermission('Environments', 'read', true)
  const userCanReadSecrets = hasPermission('Secrets', 'read', true)
  const userCanCreateSecrets = hasPermission('Secrets', 'create', true)
  const userCanUpdateSecrets = hasPermission('Secrets', 'update', true)
  const userCanDeleteSecrets = hasPermission('Secrets', 'delete', true)
  const userCanReadSyncs = hasPermission('Integrations', 'read', true)
  const userCanCreateRotation = hasPermission('RotatingSecrets', 'create', true)

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

  const [serverAppSecrets, setServerAppSecrets] = useState<AppSecret[]>([])
  const [clientAppSecrets, setClientAppSecrets] = useState<AppSecret[]>([])
  const [secretsToDelete, setSecretsToDelete] = useState<string[]>([])
  const [appSecretsToDelete, setAppSecretsToDelete] = useState<string[]>([])

  const [expandedSecrets, setExpandedSecrets] = useState<string[]>([])

  const [revealOnHover, setRevealOnHover] = useState(false)

  const [searchQuery, setSearchQuery] = useState<string>('')

  const [sort, _setSort] = useState<SortOption>(() => getSavedSort() ?? '-created')
  const setSort = useCallback((option: SortOption) => {
    _setSort(option)
    saveSort(option)
  }, [])

  const [bulkProcessSecrets, { loading: bulkUpdatePending }] = useMutation(BulkProcessSecrets)

  const [isLoading, setIsLoading] = useState(false)

  const importDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const refWarningDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const [refWarnings, setRefWarnings] = useState<ReferenceValidationError[]>([])

  const savingAndFetching = bulkUpdatePending || isLoading

  const { keyring } = useContext(KeyringContext)

  const normalizeValues = (values: (string | undefined)[]) => values.map((value) => value ?? null) // Replace undefined with null for consistent comparison

  // O(secrets × envs) — memoized so it doesn't run on every keystroke render
  const unsavedChanges = useMemo(() => {
    const clientById = new Map(clientAppSecrets.map((s) => [s.id, s]))
    return (
      // Check if any secrets are staged for delete
      secretsToDelete.length > 0 ||
      // Check if any new secret keys are added
      !arraysEqual(
        clientAppSecrets.map((appSecret) => appSecret.key),
        serverAppSecrets.map((appSecret) => appSecret.key)
      ) ||
      // Check if values are modified for existing secrets
      serverAppSecrets.some((appSecret) => {
        const clientSecret = clientById.get(appSecret.id)

        if (!clientSecret) return true // Secret is missing in client (potential deletion)

        // Check if types have changed
        const serverType = appSecret.envs.find((env) => env.secret !== null)?.secret?.type
        const clientType = clientSecret.envs.find((env) => env.secret !== null)?.secret?.type
        if (serverType !== clientType) return true

        // Check if comments have changed in any env
        if (
          !arraysEqual(
            appSecret.envs.map((env) => env.secret?.comment ?? null),
            clientSecret.envs.map((env) => env.secret?.comment ?? null)
          )
        )
          return true

        // Check if tags have changed in any env
        if (
          appSecret.envs.some(
            (env, index) =>
              !areTagsAreSame(
                env.secret?.tags ?? [],
                clientSecret.envs[index]?.secret?.tags ?? []
              )
          )
        )
          return true

        return !arraysEqual(
          normalizeValues(appSecret.envs.map((env) => env.secret?.value)),
          normalizeValues(clientSecret.envs.map((env) => env.secret?.value))
        )
      })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientAppSecrets, serverAppSecrets, secretsToDelete])

  useWarnIfUnsavedChanges(unsavedChanges)

  // Manual env selection for this view (from the tab bar menu or Alt+Click on
  // env tabs). A selection change reprocesses the data and resets client
  // state, so it's locked while there are unsaved changes.
  const { selectedEnvIds, setSelectionLocked } = useEnvSelection()

  useEffect(() => {
    setSelectionLocked(unsavedChanges)
    return () => setSelectionLocked(false)
  }, [unsavedChanges, setSelectionLocked])

  const {
    appEnvironments,
    visibleEnvironments,
    appSecrets,
    appFolders,
    appDynamicSecrets,
    fetching,
    refetch,
  } = useAppSecrets(
    app,
    userCanReadSecrets,
    unsavedChanges ? 0 : 10000, // Poll every 10 seconds
    secretPath,
    selectedEnvIds
  )

  // Fetch and decrypt all org secret keys for cross-app reference autocomplete/validation
  const { orgApps: allOrgApps } = useOrgSecretKeys()

  // Build stabilized reference context for autocomplete
  const secretKeysFingerprint = clientAppSecrets.map((s) => s.key).join('\0')
  const referenceContext: ReferenceContext = useMemo(() => {
    const secretKeys = clientAppSecrets.map((s) => s.key).filter((k) => k !== '')

    const currentAppName = data?.apps?.[0]?.name?.toLowerCase()
    const currentAppData = allOrgApps.find((a) => a.name.toLowerCase() === currentAppName)

    // Start from the org-wide key data so references into envs hidden by the
    // env selection still validate, then override the visible envs with
    // client-side state
    const envSecretKeys: Record<string, string[]> = {
      ...(currentAppData?.envSecretKeys ?? {}),
    }
    for (const env of visibleEnvironments) {
      envSecretKeys[env.name.toLowerCase()] = clientAppSecrets
        .filter((s) => s.envs.some((e) => e.env.id === env.id && e.secret !== null))
        .map((s) => s.key)
        .filter((k) => k !== '')
    }

    const envNames = (appEnvironments ?? []).map((e) => e.name)

    const folderPaths = appFolders.map((f) => `${f.path}/${f.name}`.replace(/^\/+/, ''))

    // Exclude the current app from cross-app suggestions
    const orgApps = allOrgApps.filter((a) => a.name.toLowerCase() !== currentAppName)

    // Extract folder-qualified and root-level secret keys for the current app
    const folderSecretKeys = currentAppData?.folderKeys ?? {}
    const envFolderKeys = currentAppData?.envFolderKeys ?? {}
    const envRootKeys = currentAppData?.envRootKeys ?? {}

    const deletedKeys = clientAppSecrets
      .filter((s) => appSecretsToDelete.includes(s.id))
      .map((s) => s.key)

    // Build env ID mapping for navigation
    const envIds: Record<string, string> = {}
    for (const env of appEnvironments ?? []) {
      envIds[env.name.toLowerCase()] = env.id
    }

    const secretIdLookup = currentAppData?.secretIdLookup ?? {}

    return {
      teamSlug: team,
      appId: app,
      envIds,
      secretIdLookup,
      secretKeys,
      envSecretKeys,
      envRootKeys,
      envNames,
      folderPaths,
      folderSecretKeys,
      envFolderKeys,
      orgApps,
      deletedKeys,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    secretKeysFingerprint,
    appEnvironments,
    visibleEnvironments,
    appFolders,
    allOrgApps,
    data,
    appSecretsToDelete,
  ])

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

  const handleUpdateSecretType = useCallback(
    (id: string, type: ApiSecretTypeChoices) => {
      setClientAppSecrets((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s
          return {
            ...s,
            envs: s.envs.map((env) => ({
              ...env,
              secret: env.secret ? { ...env.secret, type } : env.secret,
            })),
          }
        })
      )
    },
    []
  )

  // Tags and comments are managed at the key level in the cross-env view and
  // propagate to the secret in every environment, like the type does.
  const handleUpdateSecretTags = useCallback((id: string, tags: SecretTagType[]) => {
    setClientAppSecrets((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s
        return {
          ...s,
          envs: s.envs.map((env) => ({
            ...env,
            secret: env.secret ? { ...env.secret, tags } : env.secret,
          })),
        }
      })
    )
  }, [])

  const handleUpdateSecretComment = useCallback((id: string, comment: string) => {
    setClientAppSecrets((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s
        return {
          ...s,
          envs: s.envs.map((env) => ({
            ...env,
            secret: env.secret ? { ...env.secret, comment } : env.secret,
          })),
        }
      })
    )
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

  const expandedSet = useMemo(() => new Set(expandedSecrets), [expandedSecrets])

  const allRowsAreExpanded = useMemo(
    () => [...clientAppSecrets, ...appDynamicSecrets].every((item) => expandedSet.has(item.id)),
    [clientAppSecrets, appDynamicSecrets, expandedSet]
  )

  useEffect(() => {
    if (appSecrets) {
      setServerAppSecrets(appSecrets)
      setClientAppSecrets(appSecrets)
    }
  }, [appSecrets])

  const filteredSecrets = useMemo(() => {
    const filtered =
      searchQuery === ''
        ? clientAppSecrets
        : clientAppSecrets.filter((secret) => {
            const searchRegex = new RegExp(escapeRegExp(searchQuery), 'i')
            const valueMatch = secret.envs.some(
              (env) => env.secret && searchRegex.test(env.secret.value)
            )
            return searchRegex.test(secret.key) || valueMatch
          })
    return sortAppSecrets(filtered, sort)
  }, [clientAppSecrets, searchQuery, sort])

  const filteredDynamicSecrets = useMemo(
    () =>
      searchQuery === ''
        ? appDynamicSecrets
        : appDynamicSecrets.filter((secret) => {
            const searchRegex = new RegExp(escapeRegExp(searchQuery), 'i')
            return searchRegex.test(secret.name)
          }),
    [appDynamicSecrets, searchQuery]
  )

  // Rotating-secret metadata across the app so we can render group headers.
  const { data: rotatingData } = useQuery(GetRotatingSecrets, {
    variables: { orgId: organisation?.id, appId: app },
    skip: !organisation,
    fetchPolicy: 'cache-and-network',
    pollInterval: 30_000,
  })
  const rotatingSecretsById = useMemo(() => {
    const map = new Map<string, RotatingSecretType>()
    for (const rs of (rotatingData?.rotatingSecrets ?? []) as RotatingSecretType[]) {
      if (rs?.id) map.set(rs.id, rs)
    }
    return map
  }, [rotatingData])

  // Union-find by shared rotatingSecretId across envs of each AppSecret.
  // Each connected component is one group of outputs that belong together.
  const rotatingGroups = useMemo(() => {
    type Group = {
      appSecretIds: Set<string>
      rotatingSecretIds: Set<string>
    }
    const groupOfAppSecret = new Map<string, Group>()
    const groupOfRotatingId = new Map<string, Group>()
    for (const appSecret of filteredSecrets) {
      const localRsIds = new Set<string>()
      for (const e of appSecret.envs) {
        const rid = e.secret?.rotatingSecretId
        if (rid) localRsIds.add(rid)
      }
      if (localRsIds.size === 0) continue
      // Find existing groups this AppSecret connects to.
      const touched = new Set<Group>()
      for (const rid of localRsIds) {
        const g = groupOfRotatingId.get(rid)
        if (g) touched.add(g)
      }
      let group: Group
      if (touched.size === 0) {
        group = { appSecretIds: new Set(), rotatingSecretIds: new Set() }
      } else {
        // Merge all touched groups into one.
        const iter = touched.values()
        group = iter.next().value as Group
        for (const other of touched) {
          if (other === group) continue
          for (const id of other.appSecretIds) group.appSecretIds.add(id)
          for (const rid of other.rotatingSecretIds) {
            group.rotatingSecretIds.add(rid)
            groupOfRotatingId.set(rid, group)
          }
          for (const id of other.appSecretIds) groupOfAppSecret.set(id, group)
        }
      }
      group.appSecretIds.add(appSecret.id)
      groupOfAppSecret.set(appSecret.id, group)
      for (const rid of localRsIds) {
        group.rotatingSecretIds.add(rid)
        groupOfRotatingId.set(rid, group)
      }
    }
    return { groupOfAppSecret, groupOfRotatingId }
  }, [filteredSecrets])

  // Linearised render order: each item is either a single AppSecret, a
  // rotating-secret group, or a dynamic-secret group. The render loop walks
  // this list in order and increments a single shared index counter so
  // numbering matches what the user sees top-to-bottom.
  type SecretListItem =
    | { kind: 'single'; secret: AppSecret }
    | {
        kind: 'group'
        groupKey: string
        rotatingSecretIds: string[]
        appSecrets: AppSecret[]
      }
    | {
        kind: 'dynamicGroup'
        appDynamicSecret: (typeof filteredDynamicSecrets)[number]
        keyMap: Array<{ id: string; keyName: string }>
      }
  const secretListItems = useMemo<SecretListItem[]>(() => {
    const out: SecretListItem[] = []

    // Dynamic-secret groups render first, mirroring the previous layout
    // (dynamic above static). Each gets one row per key_map entry.
    for (const appDynamicSecret of filteredDynamicSecrets) {
      const sourceDs = appDynamicSecret.envs.find((e) => e.dynamicSecret !== null)?.dynamicSecret
      const keyMap = ((sourceDs?.keyMap ?? []) as Array<{
        id?: string | null
        keyName?: string | null
      } | null>).flatMap((k) =>
        k && k.id && k.keyName ? [{ id: k.id, keyName: k.keyName }] : []
      )
      out.push({ kind: 'dynamicGroup', appDynamicSecret, keyMap })
    }

    const emitted = new Set<string>()
    const idToAppSecret = new Map<string, AppSecret>()
    for (const s of filteredSecrets) idToAppSecret.set(s.id, s)
    for (const appSecret of filteredSecrets) {
      if (emitted.has(appSecret.id)) continue
      const group = rotatingGroups.groupOfAppSecret.get(appSecret.id)
      if (group) {
        const items = Array.from(group.appSecretIds)
          .map((id) => idToAppSecret.get(id))
          .filter((s): s is AppSecret => Boolean(s))
        items.sort(
          (a, b) => filteredSecrets.indexOf(a) - filteredSecrets.indexOf(b)
        )
        out.push({
          kind: 'group',
          groupKey: Array.from(group.rotatingSecretIds).sort().join(','),
          rotatingSecretIds: Array.from(group.rotatingSecretIds),
          appSecrets: items,
        })
        for (const s of items) emitted.add(s.id)
      } else {
        out.push({ kind: 'single', secret: appSecret })
        emitted.add(appSecret.id)
      }
    }
    return out
  }, [filteredSecrets, filteredDynamicSecrets, rotatingGroups])

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

  // O(1) lookup — a per-row .find() would make each table render O(n²)
  const serverAppSecretsById = useMemo(
    () => new Map(serverAppSecrets.map((secret) => [secret.id, secret])),
    [serverAppSecrets]
  )
  const serverSecret = (id: string) => serverAppSecretsById.get(id)

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

    const clientSecrets: SecretType[] = flattenAppSecrets(clientAppSecrets)
    const serverSecrets: SecretType[] = flattenAppSecrets(serverAppSecrets)

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
          (serverSecret.key !== clientSecret.key ||
            serverSecret.value !== clientSecret.value ||
            serverSecret.type !== clientSecret.type ||
            (serverSecret.comment ?? '') !== (clientSecret.comment ?? '') ||
            !areTagsAreSame(serverSecret.tags ?? [], clientSecret.tags ?? []))

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
            path: clientSecret.path || secretPath,
            key: encryptedKey,
            keyDigest,
            value: encryptedValue,
            comment: encryptedComment,
            tags: tagIds,
            type: clientSecret.type?.toLowerCase() || 'secret',
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

      // The sync effect on `appSecrets` publishes the refetched data into
      // server/client state once decryption completes — setting state from
      // the current `appSecrets` binding here would revert to a stale,
      // pre-deploy snapshot.
      await refetch()
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

    // Validate secret references
    const activeSecrets = clientAppSecrets.filter((s) => !appSecretsToDelete.includes(s.id))
    const refErrors = validateSecretReferences(activeSecrets, referenceContext)
    if (refErrors.length > 0) {
      setRefWarnings(refErrors)
      refWarningDialogRef.current?.openModal()
      setIsLoading(false)
      return false
    }

    await handleBulkUpdateSecrets()

    setIsLoading(false)

    toast.success('Changes successfully deployed.')
  }

  const handleSaveWithBrokenRefs = async () => {
    refWarningDialogRef.current?.closeModal()
    setRefWarnings([])
    setIsLoading(true)
    await handleBulkUpdateSecrets()
    setIsLoading(false)
    toast.success('Changes successfully deployed.')
  }

  const handleAddNewClientSecret = (initialKey?: string, type: ApiSecretTypeChoices = ApiSecretTypeChoices.Secret) => {
    const keyToUse = initialKey ?? ''
    // New secrets are only created in the envs currently shown — what you
    // see is what you deploy
    const envs: EnvironmentType[] = visibleEnvironments

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
              path: secretPath,
              type,
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
                path: secretPath,
                type: ApiSecretTypeChoices.Secret,
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
          // Inherit key-level metadata (type, tags, comment) from existing env
          // secrets for this key
          const sourceSecret = appSecret.envs.find((env) => env.secret !== null)?.secret
          const newSecret = {
            id: `new-${crypto.randomUUID()}`,
            updatedAt: null,
            version: 1,
            key: '',
            value: '',
            tags: sourceSecret?.tags ?? [],
            comment: sourceSecret?.comment ?? '',
            path: secretPath,
            type: sourceSecret?.type ?? ApiSecretTypeChoices.Config,
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

  // Flattened views of the app secrets, used for the deploy preview
  const flatClientSecrets = useMemo(() => flattenAppSecrets(clientAppSecrets), [clientAppSecrets])
  const flatServerSecrets = useMemo(() => flattenAppSecrets(serverAppSecrets), [serverAppSecrets])

  const [createFolder, { loading: createFolderPending }] = useMutation(CreateNewSecretFolder)
  const newFolderDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const [newFolderName, setNewFolderName] = useState('')

  const handleUpdateNewFolderName = (name: string) => {
    if (/^[a-zA-Z0-9]*$/.test(name)) setNewFolderName(name)
  }

  // Creates the folder at the current path in every environment. Envs where
  // the folder already exists are skipped by the server-side unique check.
  const handleCreateFolder = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (isReservedFolderName(newFolderName, secretPath)) {
      toast.error(`"${newFolderName}" is a reserved name and cannot be used for root folders`)
      return
    }

    const results = await Promise.allSettled(
      (appEnvironments ?? []).map((env: EnvironmentType) =>
        createFolder({
          variables: { envId: env.id, name: newFolderName, path: secretPath },
        })
      )
    )

    if (results.some((result) => result.status === 'fulfilled')) {
      toast.success('Created new Folder', { autoClose: 2000 })
      setNewFolderName('')
      newFolderDialogRef.current?.closeModal()
      refetch()
    } else {
      toast.error('Failed to create the Folder')
    }
  }

  return (
    <SecretReferenceContext.Provider value={referenceContext}>
      {/* Flex column so the table wrapper (flex-1) is the only vertically
          scrolling region — search/deploy/toolbar stay pinned above it */}
      <section className="space-y-4 flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-3 sm:gap-4 lg:gap-6 justify-between w-full">
          <div className="flex items-center gap-3 sm:gap-4 lg:gap-6">
            <h1 className="h3 font-semibold text-lg" id="secrets" title="Secrets across all Environments in this App">
              All Environments
            </h1>
            <div className="flex items-center gap-2">
              <PathBreadcrumbs basePath={basePath} path={pathSegments} />
            </div>
          </div>
          <div>
            {unsavedChanges && (
              <DeployPreview
                clientSecrets={flatClientSecrets}
                serverSecrets={flatServerSecrets}
                secretsToDelete={secretsToDelete}
                showEnvironment
              />
            )}
          </div>
        </div>

        <div className="flex items-center w-full justify-between border-b border-neutral-500/20 pb-4">
          <div className="flex items-center gap-2">
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
            <div className="relative">
              <SortMenu sort={sort} setSort={setSort} />
            </div>
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

        {visibleEnvironments.length > 0 && (
          <MultiEnvImportDialog
            environments={visibleEnvironments}
            path={secretPath}
            addSecrets={bulkAddNewClientSecrets}
            ref={importDialogRef}
          />
        )}

        <GenericDialog
          ref={newFolderDialogRef}
          title="Create a Folder"
          onClose={() => setNewFolderName('')}
        >
          <div className="space-y-2 py-4">
            <p className="text-neutral-500">
              A new folder will be created at{' '}
              <code className="border border-neutral-500/20 rounded-full px-1 py-0.5 font-semibold">
                {secretPath === '/' ? '' : secretPath}/
                <span className="text-emerald-500">{newFolderName}</span>
              </code>{' '}
              in all Environments of this App.
            </p>
            <form className="flex items-end justify-between gap-4" onSubmit={handleCreateFolder}>
              <Input
                value={newFolderName}
                setValue={handleUpdateNewFolderName}
                label="Folder name"
                required
                maxLength={32}
              />
              <Button
                type="submit"
                variant="primary"
                disabled={newFolderName.length === 0}
                isLoading={createFolderPending}
              >
                Create
              </Button>
            </form>
          </div>
        </GenericDialog>

        <BrokenReferencesDialog
          ref={refWarningDialogRef}
          warnings={refWarnings}
          onSaveAnyway={handleSaveWithBrokenRefs}
        />

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
              {userCanCreateSecrets ? (
                <SplitButton
                  variant="primary"
                  onClick={() => handleAddNewClientSecret()}
                  menuContent={
                    <div className="w-max flex flex-col items-start gap-1">
                      <Button
                        variant="secondary"
                        onClick={() => newFolderDialogRef.current?.openModal()}
                      >
                        <div className="flex items-center gap-2">
                          <FaFolderPlus /> New Folder
                        </div>
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => importDialogRef.current?.openModal()}
                      >
                        <div className="flex items-center gap-2">
                          <TbDownload /> Import secrets
                        </div>
                      </Button>
                    </div>
                  }
                >
                  <FaPlus /> New Secret
                </SplitButton>
              ) : (
                <Button variant="secondary" onClick={() => importDialogRef.current?.openModal()}>
                  <TbDownload /> Import secrets
                </Button>
              )}
            </div>
          </div>
        )}

        {clientAppSecrets.length > 0 ||
        appFolders.length > 0 ||
        appDynamicSecrets.length > 0 ||
        searchQuery ? (
          <>
            {filteredSecrets.length > 0 ||
            filteredFolders.length > 0 ||
            filteredDynamicSecrets.length > 0 ? (
              // The only vertically scrolling region — the sticky thead
              // sticks to its top while rows scroll under it
              <div className="flex-1 min-h-0 overflow-auto">
                {/* Fixed layout: the key column takes a third, env columns
                    share the rest equally regardless of env name length */}
                <table
                  className="table-fixed w-full"
                  // Fixed floor (not scaled by env count) so many envs squeeze
                  // into the viewport instead of overflowing it. 68rem keeps
                  // the key column (1/3 ≈ 362px) at least as wide as its
                  // content's min-width (row number + min-w-80 input) before
                  // horizontal scroll kicks in on narrow windows.
                  style={{ minWidth: '68rem' }}
                >
                  <thead
                    id="table-head"
                    className="sticky top-0 z-10 bg-zinc-200/50 dark:bg-zinc-900/50 backdrop-blur-sm"
                  >
                    <tr>
                      <th className="w-1/3 pl-10 text-left text-2xs 2xl:text-sm font-medium text-gray-500 uppercase tracking-wide">
                        key
                      </th>
                      {visibleEnvironments.map((env: EnvironmentType) => (
                        <th
                          key={env.id}
                          className="group text-center text-2xs 2xl:text-sm font-semibold uppercase p-2"
                        >
                          <div className="flex justify-center min-w-0">
                            <Link
                              href={`${basePath}/environments/${env.id}${pathSuffix}`}
                              className="block min-w-0 max-w-full"
                              title={env.name}
                            >
                              <Button variant="ghost">
                                <span className="truncate min-w-0">{env.name}</span>
                                <span className="opacity-30 group-hover:opacity-100 transform -translate-x-1 group-hover:translate-x-0 transition ease shrink-0">
                                  <FaArrowRight />
                                </span>
                              </Button>
                            </Link>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-500/20 rounded-md">
                    {filteredFolders.map((appFolder) => (
                      <AppFolderRow
                        key={`${appFolder.path}/${appFolder.name}`}
                        appFolder={appFolder}
                        href={`${basePath}${pathSuffix}/${appFolder.name}`}
                      />
                    ))}

                    {(() => {
                      const envs = visibleEnvironments
                      const colSpanForGroup = 1 + envs.length
                      let runningIndex = 0
                      const renderRow = (appSecret: AppSecret) => {
                        const idx = runningIndex++
                        return (
                          <AppSecretRow
                            index={idx}
                            isExpanded={expandedSet.has(appSecret.id)}
                            expand={handleExpandRow}
                            collapse={handleCollapseRow}
                            key={appSecret.id}
                            clientAppSecret={appSecret}
                            serverAppSecret={serverSecret(appSecret.id)}
                            updateKey={handleUpdateSecretKey}
                            updateType={handleUpdateSecretType}
                            updateTags={handleUpdateSecretTags}
                            updateComment={handleUpdateSecretComment}
                            addEnvValue={handleAddNewEnvValue}
                            deleteEnvValue={stageEnvValueForDelete}
                            updateValue={handleUpdateSecretValue}
                            deleteKey={handleStageClientSecretForDelete}
                            stagedForDelete={appSecretsToDelete.includes(appSecret.id)}
                            revealOnHover={revealOnHover}
                            basePath={basePath}
                            secretPath={secretPath}
                            canUpdateSecrets={userCanUpdateSecrets}
                            canDeleteSecrets={userCanDeleteSecrets}
                          />
                        )
                      }
                      return secretListItems.map((item) => {
                        if (item.kind === 'single') return renderRow(item.secret)
                        if (item.kind === 'dynamicGroup') {
                          const headDs = item.appDynamicSecret.envs.find(
                            (e) => e.dynamicSecret !== null
                          )?.dynamicSecret
                          return (
                            <AppDynamicSecretGroup
                              key={`dgroup-${item.appDynamicSecret.id}`}
                              environments={envs}
                              perEnvDynamicSecrets={item.appDynamicSecret.envs}
                              displayName={item.appDynamicSecret.name}
                              providerId={headDs?.provider ?? null}
                              colSpan={colSpanForGroup}
                              team={team}
                              app={app}
                              canSetUpIn={() => userCanCreateSecrets}
                            >
                              {item.keyMap.map((k) => (
                                <AppDynamicSecretKeyRow
                                  key={`${item.appDynamicSecret.id}-${k.id}`}
                                  index={runningIndex++}
                                  keyName={k.keyName}
                                  envs={item.appDynamicSecret.envs}
                                />
                              ))}
                            </AppDynamicSecretGroup>
                          )
                        }
                        const groupRotatingSecrets = item.rotatingSecretIds
                          .map((rid) => rotatingSecretsById.get(rid))
                          .filter((rs): rs is RotatingSecretType => Boolean(rs))
                        return (
                          <AppRotatingSecretGroup
                            key={`group-${item.groupKey}`}
                            groupRotatingSecrets={groupRotatingSecrets}
                            environments={envs}
                            colSpan={colSpanForGroup}
                            team={team}
                            app={app}
                            canSetUpIn={() => userCanCreateRotation}
                          >
                            {item.appSecrets.map((s) => renderRow(s))}
                          </AppRotatingSecretGroup>
                        )
                      })
                    })()}
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
            {/* Hidden for now — takes up too much vertical space under the
                table; may find a better home (e.g. a help popover) later.
            <SecretInfoLegend /> */}
          </>
        ) : isLoading || fetching || (appSecrets?.length > 0 && clientAppSecrets.length === 0) ? (
          <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="bg-zinc-300 dark:bg-zinc-700 animate-pulse rounded-full h-8 w-28" />
              <div className="bg-zinc-300 dark:bg-zinc-700 animate-pulse rounded-full h-8 w-28" />
              <div className="bg-zinc-300 dark:bg-zinc-700 animate-pulse rounded-full h-8 w-36" />
            </div>
            <div className="flex items-center gap-4 pr-4">
              <div className="bg-zinc-300 dark:bg-zinc-700 animate-pulse rounded-full h-8 w-32" />
              <div className="bg-zinc-300 dark:bg-zinc-700 animate-pulse rounded-full h-8 w-28" />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-auto">
            <table className="table-fixed w-full" style={{ minWidth: '68rem' }}>
              <thead
                id="table-head"
                className="sticky top-0 z-10 bg-zinc-200/50 dark:bg-zinc-900/50 backdrop-blur-sm"
              >
                <tr>
                  <th className="w-1/3 pl-10 text-left text-2xs 2xl:text-sm font-medium text-gray-500 uppercase tracking-wide">
                    key
                  </th>
                  {['Development', 'Staging', 'Production'].map((envName) => (
                    <th
                      key={envName}
                      className="group text-center text-2xs 2xl:text-sm font-semibold uppercase p-2"
                    >
                      <div className="flex justify-center min-w-0">
                        <Button variant="ghost">
                          <span className="truncate min-w-0">{envName}</span>
                          <span className="opacity-30 shrink-0">
                            <FaArrowRight />
                          </span>
                        </Button>
                      </div>
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
          </>
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
                <Button
                  variant="outline"
                  onClick={() => newFolderDialogRef.current?.openModal()}
                >
                  <FaFolderPlus /> New Folder
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
            <div className="flex items-center gap-4">
              <Button variant="outline" onClick={() => importDialogRef.current?.openModal()}>
                <TbDownload /> Import secrets
              </Button>
              <Button
                variant="primary"
                onClick={() => handleAddNewClientSecret()}
              >
                <FaPlus /> New Secret
              </Button>
            </div>
          </EmptyState>
        )}
      </section>
    </SecretReferenceContext.Provider>
  )
}
