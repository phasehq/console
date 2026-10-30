'use client'

import { BulkProcessSecrets } from '@/graphql/mutations/environments/bulkProcessSecrets.gql'
import { CreateNewSecretFolder } from '@/graphql/mutations/environments/createFolder.gql'
import { DeleteFolder } from '@/graphql/mutations/environments/deleteFolder.gql'
import { CreateEnvironmentDialogHandle } from '@/components/environments/CreateEnvironmentDialog'
import { LogSecretReads } from '@/graphql/mutations/environments/readSecret.gql'
import { UpdateEnvOrder } from '@/graphql/mutations/environments/updateEnvironmentOrder.gql'
import { GetAppSyncStatus } from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetAppDetail } from '@/graphql/queries/getAppDetail.gql'
import { GetRotatingSecrets } from '@/graphql/queries/secrets/rotation/getRotatingSecrets.gql'
import { useMutation, useQuery } from '@apollo/client'
import {
  Fragment,
  ReactElement,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSearchParams } from 'next/navigation'
import {
  ApiOrganisationPlanChoices,
  ApiSecretTypeChoices,
  EnvironmentType,
  RotatingSecretType,
  SecretInput,
  SecretTagType,
  SecretType,
} from '@/apollo/graphql'
import { KeyringContext } from '@/contexts/keyringContext'
import { organisationContext } from '@/contexts/organisationContext'
import { MdPassword, MdSearchOff } from 'react-icons/md'
import {
  FaBan,
  FaCheckCircle,
  FaChevronDown,
  FaCloudUploadAlt,
  FaDownload,
  FaEye,
  FaEyeSlash,
  FaFolderPlus,
  FaLink,
  FaPlus,
  FaRegEye,
  FaSearch,
  FaTimesCircle,
  FaUndo,
} from 'react-icons/fa'
import { FaXmark } from 'react-icons/fa6'
import { TbDownload } from 'react-icons/tb'
import { Menu, Switch, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { Button } from '@/components/common/Button'
import { SplitButton } from '@/components/common/SplitButton'
import { Input } from '@/components/common/Input'
import GenericDialog from '@/components/common/GenericDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { EnvSyncStatus } from '@/components/syncing/EnvSyncStatus'
import MultiEnvImportDialog from '@/components/environments/secrets/import/MultiEnvImportDialog'
import SortMenu from '@/components/environments/secrets/SortMenu'
import FilterMenu from '@/components/environments/secrets/FilterMenu'
import { PathBreadcrumbs } from '@/components/environments/secrets/PathBreadcrumbs'
import { DeployPreview } from '@/components/environments/secrets/DeployPreview'
import { BrokenReferencesDialog } from '@/components/secrets/BrokenReferencesDialog'
import { SecretReferenceContext } from '@/contexts/secretReferenceContext'
import { useAppPermissions } from '@/hooks/useAppPermissions'
import { useOrgSecretKeys } from '@/hooks/useOrgSecretKeys'
import { useWarnIfUnsavedChanges } from '@/hooks/warnUnsavedChanges'
import {
  digest,
  encryptAsymmetric,
  decryptAsymmetric,
  getUserKxPrivateKey,
  getUserKxPublicKey,
  arraysEqual,
} from '@/utils/crypto'
import { areTagsAreSame } from '@/utils/tags'
import { formatTitle } from '@/utils/meta'
import {
  exportToEnvFile,
  getSavedSort,
  isReservedFolderName,
  normalizeKey,
  saveSort,
  SortOption,
  sortAppSecrets,
  SecretFilter,
  EMPTY_SECRET_FILTER,
  filterIsActive,
  appSecretMatchesFilter,
  showDynamicUnderFilter,
  collectAppSecretTags,
  parseSecretSearch,
  appSecretMatchesSearch,
  dynamicSearchText,
  dynamicMatchesSearch,
  hasRegularOnlyFacet,
  FOLDER_NAME_REGEX,
} from '@/utils/secrets'
import {
  appSecretRowIsEdited,
  dirtyEnvIds,
  duplicateKeyRowIds,
  flattenAppSecrets,
  groupRotatingRows,
  mergeAppSecretsUpdate,
  RowListItem,
} from '@/utils/appSecrets'
import {
  validateSecretReferences,
  ReferenceContext,
  ReferenceValidationError,
} from '@/utils/secretReferences'
import {
  AppDynamicSecret,
  appSecretsCacheKey,
  ProcessedAppSecrets,
  useAppSecrets,
} from '../_hooks/useAppSecrets'
import { AppFolder, AppSecret } from '../types'
import { AppSecretRow } from './AppSecretRow'
import { AppDynamicSecretGroup } from './AppDynamicSecretGroup'
import { AppDynamicSecretKeyRow } from './AppDynamicSecretKeyRow'
import { AppFolderRow } from './AppFolderRow'
import { DeleteAppFolderDialog, FolderDeleteTarget, FolderInEnv } from './DeleteAppFolderDialog'
import { keyColumnId, useColumnWidths } from '../_hooks/useColumnWidths'
import { AppRotatingSecretGroup } from './AppRotatingSecretGroup'
import { AppSecretRowSkeleton } from './AppSecretRowSkeleton'
import { SecretWithFlags } from './EnvValueCell'
import { useEnvSelection, filterEnvSelection } from './EnvSelectionProvider'
import { GRID_HEADER_BG, GRID_HEADER_BG_SOLID, SecretsGridHeader } from './SecretsGridHeader'
import { GridScrollControls } from './GridScrollControls'
import { useSecretsCache } from './SecretsCacheProvider'
import {
  GRID_TABLE,
  GridColumn,
  NEW_ENV_COLUMN_REM,
  NEW_ENV_COLUMN_UPSELL_REM,
  SLIM_COLUMN_WIDTH,
  TRAILING_REM,
  clampColumnPx,
  columnsSignature,
  gridLayout,
} from './gridColumns'

const NO_DIRTY_ENVS = new Set<string>()

/** Viewport width and root font size, which the grid's column widths are computed from */
const useViewportMetrics = () => {
  // A fixed first value keeps the server render and hydration in agreement
  const [metrics, setMetrics] = useState({ width: 1440, rootFontPx: 16 })
  useEffect(() => {
    let frame = 0
    const measure = () =>
      setMetrics({
        width: window.innerWidth,
        rootFontPx: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
      })
    const onResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('resize', onResize)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onResize)
    }
  }, [])
  return metrics
}

const entryFor = (row: AppSecret | undefined, envId: string) =>
  row?.envs.find((entry) => entry.env.id === envId)

type CachedRow = { deps: unknown[]; element: ReactElement }

const sameItems = (a: unknown[], b: unknown[]) =>
  a.length === b.length && a.every((item, i) => Object.is(item, b[i]))

/** One rendered line of the folder tree */
type TreeItem =
  | { kind: 'folder'; folder: AppFolder; fullPath: string; depth: number; expanded: boolean }
  | (RowListItem & { depth: number })
  | {
      kind: 'dynamicGroup'
      appDynamicSecret: AppDynamicSecret
      keyMap: Array<{ id: string; keyName: string }>
      depth: number
    }

// One tree level indents 1rem, about two key characters wide
const INDENT_CHARS = 2

const folderFullPath = (folder: { name: string; path: string }) =>
  `${folder.path === '/' ? '' : folder.path}/${folder.name}`

const parentPath = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'

const groupBy = <T,>(items: T[], keyOf: (item: T) => string) => {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  return groups
}

/** Only the given envs' entries — what search, filters and sorting consider */
const projectRow = (row: AppSecret, envIds: Set<string>): AppSecret => ({
  ...row,
  envs: row.envs.filter((entry) => envIds.has(entry.env.id!)),
})

const newEnvSecret = (
  environment: EnvironmentType,
  key: string,
  path: string,
  fields: Partial<SecretType> = {}
): SecretType => ({
  id: `new-${crypto.randomUUID()}`,
  updatedAt: null,
  version: 1,
  key,
  value: '',
  tags: [],
  comment: '',
  path,
  type: ApiSecretTypeChoices.Secret,
  environment,
  ...fields,
})

/**
 * The app's secrets editor: one grid with a column per environment. Checked
 * envs are edited side by side; unchecked ones collapse to slim presence
 * columns. Every edit applies to the checked envs only.
 */
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
  const { keyring } = useContext(KeyringContext)
  const searchParams = useSearchParams()

  // Folder path shared by every env column via the route
  const secretPath = pathSegments.length > 0 ? `/${pathSegments.join('/')}` : '/'
  const basePath = `/${team}/apps/${app}`
  const pathSuffix = secretPath === '/' ? '' : secretPath

  // Computed once here and passed down — useAppPermissions runs a GetTeams query
  // and JSON-parses role policies per call, far too heavy for every row and cell
  const { hasPermission } = useAppPermissions(app)
  const userCanReadEnvironments = hasPermission('Environments', 'read', true)
  const userCanCreateEnvironments = hasPermission('Environments', 'create', true)
  const userCanUpdateEnvironments = hasPermission('Environments', 'update', true)
  const userCanReadSecrets = hasPermission('Secrets', 'read', true)
  const userCanCreateSecrets = hasPermission('Secrets', 'create', true)
  const userCanUpdateSecrets = hasPermission('Secrets', 'update', true)
  const userCanDeleteSecrets = hasPermission('Secrets', 'delete', true)
  const userCanReadSyncs = hasPermission('Integrations', 'read', true)
  const userCanCreateRotation = hasPermission('RotatingSecrets', 'create', true)

  const { data: appDetail } = useQuery(GetAppDetail, {
    variables: { organisationId: organisation?.id, appId: app },
    skip: !organisation,
  })
  const appName: string | undefined = appDetail?.apps?.[0]?.name

  useEffect(() => {
    if (appName) document.title = formatTitle(`${appName} Secrets`)
  }, [appName])

  // Server snapshot and editable copy, both holding every env. Seeded from the
  // decrypted cache so a remount paints rows straight away.
  const secretsCache = useSecretsCache()
  const cachedSnapshot = () =>
    (secretsCache.get(appSecretsCacheKey(app)) as ProcessedAppSecrets | undefined)
      ?.appSecrets ?? []
  const [serverAppSecrets, setServerAppSecrets] = useState<AppSecret[]>(cachedSnapshot)
  const [clientAppSecrets, setClientAppSecrets] = useState<AppSecret[]>(() => serverAppSecrets)

  const [revealOnHover, setRevealOnHover] = useState(false)
  const [globallyRevealed, setGloballyRevealed] = useState(false)
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Expanded folders by full path; while searching, folders holding matches open on their own
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set())
  const toggleFolder = useCallback((fullPath: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (!next.delete(fullPath)) next.add(fullPath)
      return next
    })
  }, [])

  const [sort, _setSort] = useState<SortOption>(() => getSavedSort() ?? '-created')
  const setSort = useCallback((option: SortOption) => {
    _setSort(option)
    saveSort(option)
  }, [])

  // Filter menu state — intentionally not persisted, so it resets each visit.
  const [filter, setFilter] = useState<SecretFilter>(EMPTY_SECRET_FILTER)

  const [bulkProcessSecrets, { loading: bulkUpdatePending }] = useMutation(BulkProcessSecrets)
  const [readSecrets] = useMutation(LogSecretReads)
  // One mutation for every cell's reveal logging, instead of one hook per cell
  const logSecretReads = useCallback(
    (ids: string[]) => {
      readSecrets({ variables: { ids } })
    },
    [readSecrets]
  )
  const [updateEnvOrder] = useMutation(UpdateEnvOrder)
  const [createFolder, { loading: createFolderPending }] = useMutation(CreateNewSecretFolder)
  const [deleteFolder] = useMutation(DeleteFolder)

  const [isLoading, setIsLoading] = useState(false)
  const savingAndFetching = bulkUpdatePending || isLoading

  const importDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const refWarningDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const newFolderDialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const [refWarnings, setRefWarnings] = useState<ReferenceValidationError[]>([])

  // Staged deletes are flags on the client copy; this is the list a deploy sends
  const secretsToDelete = useMemo(
    () =>
      clientAppSecrets.flatMap((row) =>
        row.envs
          .filter((entry) => (entry.secret as SecretWithFlags | null)?.stagedForDelete)
          .map((entry) => entry.secret!.id)
      ),
    [clientAppSecrets]
  )

  // Content-keyed so the header and the selection lock only update when the set changes
  const dirtyKey = useMemo(
    () =>
      clientAppSecrets === serverAppSecrets
        ? ''
        : [...dirtyEnvIds(serverAppSecrets, clientAppSecrets)].sort().join(','),
    [clientAppSecrets, serverAppSecrets]
  )
  const dirtyEnvSet = useMemo(
    () => (dirtyKey ? new Set(dirtyKey.split(',')) : NO_DIRTY_ENVS),
    [dirtyKey]
  )
  const unsavedChanges = dirtyEnvSet.size > 0
  useWarnIfUnsavedChanges(unsavedChanges)

  const { selectedEnvIds, toggleEnv, soloEnv, showAllEnvs, setDirtyEnvIds, withEnvSelection } =
    useEnvSelection()

  // Envs with undeployed changes can't be hidden until they're deployed or discarded
  useEffect(() => {
    setDirtyEnvIds(dirtyEnvSet)
  }, [dirtyEnvSet, setDirtyEnvIds])
  useEffect(() => () => setDirtyEnvIds(NO_DIRTY_ENVS), [setDirtyEnvIds])

  const { environments, appSecrets, appFolders, appDynamicSecrets, pendingEnvIds, fetching, refetch } =
    useAppSecrets(app, userCanReadSecrets, unsavedChanges ? 0 : 10000, selectedEnvIds)

  // Optimistic column order — renders instantly while the mutation + refetch confirm
  const [envOrderOverride, setEnvOrderOverride] = useState<string[] | null>(null)
  const orderedEnvironments = useMemo(() => {
    if (!envOrderOverride) return environments
    const pos = new Map(envOrderOverride.map((id, i) => [id, i]))
    return [...environments].sort(
      (a, b) =>
        (pos.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (pos.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    )
  }, [environments, envOrderOverride])

  // Drop the override once the server-confirmed order matches it
  useEffect(() => {
    if (!envOrderOverride) return
    if (arraysEqual(environments.map((env) => env.id), envOrderOverride)) setEnvOrderOverride(null)
  }, [environments, envOrderOverride])

  const checkedEnvironments = useMemo(
    () => filterEnvSelection(orderedEnvironments, selectedEnvIds),
    [orderedEnvironments, selectedEnvIds]
  )
  const checkedKey = checkedEnvironments.map((env) => env.id).join(',')
  const checkedSet = useMemo(() => new Set(checkedKey ? checkedKey.split(',') : []), [checkedKey])

  const allEnvIdsKey = orderedEnvironments.map((env) => env.id).join(',')
  const allEnvIds = useMemo(() => (allEnvIdsKey ? allEnvIdsKey.split(',') : []), [allEnvIdsKey])

  // Content-keyed: every data publish brings fresh env objects, and rows reference-compare this
  const columnsDraft: GridColumn[] = orderedEnvironments.map((env) => ({
    env,
    checked: checkedSet.has(env.id),
    pending: pendingEnvIds.includes(env.id),
  }))
  const columnsKey = columnsSignature(columnsDraft)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const columns = useMemo(() => columnsDraft, [columnsKey])
  const viewport = useViewportMetrics()
  const gridScrollerRef = useRef<HTMLDivElement>(null)

  const serverAppSecretsById = useMemo(
    () => new Map(serverAppSecrets.map((row) => [row.id, row])),
    [serverAppSecrets]
  )

  // Read by the edit handlers so they stay stable across renders
  const editableEnvIdsRef = useRef(checkedSet)
  const environmentsRef = useRef(environments)
  const serverByIdRef = useRef(serverAppSecretsById)
  const unsavedChangesRef = useRef(unsavedChanges)
  useEffect(() => {
    editableEnvIdsRef.current = checkedSet
  }, [checkedSet])
  useEffect(() => {
    environmentsRef.current = environments
  }, [environments])
  useEffect(() => {
    serverByIdRef.current = serverAppSecretsById
  }, [serverAppSecretsById])
  useEffect(() => {
    unsavedChangesRef.current = unsavedChanges
  }, [unsavedChanges])

  // New server snapshots replace both copies, or — with unsaved edits — the
  // edits are rebased onto them (e.g. hidden envs finishing their background decrypt)
  const serverSnapshotRef = useRef(serverAppSecrets)
  const resetOnNextPublishRef = useRef(false)
  useEffect(() => {
    const prevServer = serverSnapshotRef.current
    serverSnapshotRef.current = appSecrets
    if (resetOnNextPublishRef.current || !unsavedChangesRef.current) {
      resetOnNextPublishRef.current = false
      setServerAppSecrets(appSecrets)
      setClientAppSecrets(appSecrets)
      return
    }
    setServerAppSecrets(appSecrets)
    setClientAppSecrets((prev) => mergeAppSecretsUpdate(prevServer, prev, appSecrets, environments))
  }, [appSecrets, environments])

  // Fetch and decrypt all org secret keys for cross-app reference autocomplete/validation
  const { orgApps: allOrgApps } = useOrgSecretKeys()

  const secretKeysFingerprint = clientAppSecrets.map((s) => s.key).join('\0')
  const deletedKeysFingerprint = secretsToDelete.join('\0')
  const referenceContext: ReferenceContext = useMemo(() => {
    const currentAppName = appName?.toLowerCase()
    const currentAppData = allOrgApps.find((a) => a.name.toLowerCase() === currentAppName)

    // Keys at the current folder: rows now span every folder of the app
    const keysIn = (envId: string) =>
      clientAppSecrets
        .filter((row) => (row.path ?? '/') === secretPath && entryFor(row, envId)?.secret)
        .map((row) => row.key)
        .filter((key) => key !== '')

    // Org-wide key data covers the hidden envs; the checked ones use the client copy
    const envSecretKeys: Record<string, string[]> = { ...(currentAppData?.envSecretKeys ?? {}) }
    for (const env of checkedEnvironments) envSecretKeys[env.name.toLowerCase()] = keysIn(env.id)

    const envIds: Record<string, string> = {}
    for (const env of environments) envIds[env.name.toLowerCase()] = env.id

    return {
      teamSlug: team,
      appId: app,
      // A single checked env scopes local references like the old single-env view
      envId: checkedEnvironments.length === 1 ? checkedEnvironments[0].id : undefined,
      envIds,
      secretIdLookup: currentAppData?.secretIdLookup ?? {},
      secretKeys: [...new Set(checkedEnvironments.flatMap((env) => keysIn(env.id)))],
      envSecretKeys,
      envRootKeys: currentAppData?.envRootKeys ?? {},
      envNames: environments.map((env) => env.name),
      folderPaths: appFolders.map((f) => `${f.path}/${f.name}`.replace(/^\/+/, '')),
      folderSecretKeys: currentAppData?.folderKeys ?? {},
      envFolderKeys: currentAppData?.envFolderKeys ?? {},
      // Exclude the current app from cross-app suggestions
      orgApps: allOrgApps.filter((a) => a.name.toLowerCase() !== currentAppName),
      deletedKeys: clientAppSecrets
        .filter((row) =>
          row.envs.some((entry) => (entry.secret as SecretWithFlags | null)?.stagedForDelete)
        )
        .map((row) => row.key),
    }
    // Keyed on the key fingerprint: value keystrokes must not churn the context,
    // which re-renders every cell that reads it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secretKeysFingerprint, deletedKeysFingerprint, checkedEnvironments, environments, appFolders, allOrgApps, appName])

  // Cells only read the reference data while autocompleting, so they get one stable object
  // that reads the latest copy: a new context value would re-render every cell (thousands
  // in a big app) on each keystroke of a key rename
  const referenceContextRef = useRef(referenceContext)
  referenceContextRef.current = referenceContext
  const liveReferenceContext = useMemo(
    () =>
      new Proxy({} as ReferenceContext, {
        get: (_, field) => referenceContextRef.current[field as keyof ReferenceContext],
      }),
    []
  )

  // ---- Edit handlers (stable; scoped to the checked envs) ----

  const handleUpdateSecretKey = useCallback((id: string, key: string) => {
    const editable = editableEnvIdsRef.current
    setClientAppSecrets((prev) =>
      prev.map((row) =>
        row.id !== id
          ? row
          : {
              ...row,
              key,
              envs: row.envs.map((entry) =>
                entry.secret && editable.has(entry.env.id!)
                  ? { ...entry, secret: { ...entry.secret, key } }
                  : entry
              ),
            }
      )
    )
  }, [])

  const updateCheckedEntries = useCallback(
    (id: string, update: (secret: SecretType, envId: string) => SecretType) => {
      const editable = editableEnvIdsRef.current
      setClientAppSecrets((prev) =>
        prev.map((row) =>
          row.id !== id
            ? row
            : {
                ...row,
                envs: row.envs.map((entry) =>
                  entry.secret && editable.has(entry.env.id!)
                    ? { ...entry, secret: update(entry.secret, entry.env.id!) }
                    : entry
                ),
              }
        )
      )
    },
    []
  )

  const handleUpdateSecretType = useCallback(
    (id: string, type: ApiSecretTypeChoices) => {
      const serverRow = serverByIdRef.current.get(id)
      updateCheckedEntries(id, (secret, envId) =>
        // A saved sealed value can never change type
        entryFor(serverRow, envId)?.secret?.type === ApiSecretTypeChoices.Sealed
          ? secret
          : { ...secret, type }
      )
    },
    [updateCheckedEntries]
  )

  const handleUpdateSecretTags = useCallback(
    (id: string, tags: SecretTagType[]) => updateCheckedEntries(id, (secret) => ({ ...secret, tags })),
    [updateCheckedEntries]
  )

  const handleUpdateSecretComment = useCallback(
    (id: string, comment: string) =>
      updateCheckedEntries(id, (secret) => ({ ...secret, comment })),
    [updateCheckedEntries]
  )

  const handleUpdateSecretValue = useCallback((id: string, envId: string, value: string) => {
    setClientAppSecrets((prev) =>
      prev.map((row) =>
        row.id !== id
          ? row
          : {
              ...row,
              envs: row.envs.map((entry) =>
                entry.env.id === envId && entry.secret
                  ? { ...entry, secret: { ...entry.secret, value } }
                  : entry
              ),
            }
      )
    )
  }, [])

  const handleAddNewEnvValue = useCallback(
    (id: string, environment: EnvironmentType) => {
      setClientAppSecrets((prev) =>
        prev.map((row) => {
          if (row.id !== id) return row
          // Inherit the key-level type, tags and comment from the row's other values
          const source =
            row.envs.find((entry) => entry.secret && editableEnvIdsRef.current.has(entry.env.id!))
              ?.secret ?? row.envs.find((entry) => entry.secret)?.secret
          const secret = newEnvSecret(environment, row.key, row.path ?? secretPath, {
            type: source?.type ?? ApiSecretTypeChoices.Secret,
            tags: source?.tags ?? [],
            comment: source?.comment ?? '',
          })
          return {
            ...row,
            envs: row.envs.map((entry) =>
              entry.env.id === environment.id ? { ...entry, secret } : entry
            ),
          }
        })
      )
    },
    [secretPath]
  )

  /** Toggles one env value's delete; a value that was never deployed is just dropped */
  const stageEnvValueForDelete = useCallback((id: string, environment: EnvironmentType) => {
    const serverRow = serverByIdRef.current.get(id)
    const onServer = Boolean(entryFor(serverRow, environment.id)?.secret)
    setClientAppSecrets((prev) => {
      const index = prev.findIndex((row) => row.id === id)
      if (index === -1) return prev
      const row = prev[index]
      const envs = row.envs.map((entry) => {
        if (entry.env.id !== environment.id || !entry.secret) return entry
        if (!onServer) return { ...entry, secret: null }
        const secret = entry.secret as SecretWithFlags
        return { ...entry, secret: { ...secret, stagedForDelete: !secret.stagedForDelete } }
      })
      const next = prev.slice()
      if (!serverRow && envs.every((entry) => entry.secret === null)) next.splice(index, 1)
      else next[index] = { ...row, envs }
      return next
    })
  }, [])

  /** Deletes (or restores) a key in every checked env */
  const handleStageClientSecretForDelete = useCallback((id: string) => {
    const editable = editableEnvIdsRef.current
    const serverRow = serverByIdRef.current.get(id)
    setClientAppSecrets((prev) => {
      const index = prev.findIndex((row) => row.id === id)
      if (index === -1) return prev
      const row = prev[index]

      const deployedEntries = row.envs.filter(
        (entry) =>
          entry.secret && editable.has(entry.env.id!) && entryFor(serverRow, entry.env.id!)?.secret
      )
      const restore =
        deployedEntries.length > 0 &&
        deployedEntries.every((entry) => (entry.secret as SecretWithFlags).stagedForDelete)

      const envs = row.envs.map((entry) => {
        if (!entry.secret || !editable.has(entry.env.id!)) return entry
        // Never-deployed values can't be restored, so they're dropped outright
        if (!entryFor(serverRow, entry.env.id!)?.secret) return { ...entry, secret: null }
        return { ...entry, secret: { ...entry.secret, stagedForDelete: !restore } }
      })

      const next = prev.slice()
      if (!serverRow && envs.every((entry) => entry.secret === null)) next.splice(index, 1)
      else next[index] = { ...row, envs }
      return next
    })
  }, [])

  const handleAddNewClientSecret = useCallback(
    (
      initialKey: string = '',
      type: ApiSecretTypeChoices = ApiSecretTypeChoices.Secret,
      value = '',
      path: string = secretPath
    ) => {
      const editable = editableEnvIdsRef.current
      setClientAppSecrets((prev) => [
        {
          id: crypto.randomUUID(),
          key: initialKey,
          path,
          // Created in the checked envs only — what you see is what you deploy
          envs: environmentsRef.current.map((env) => ({
            env,
            secret: editable.has(env.id) ? newEnvSecret(env, initialKey, path, { type, value }) : null,
          })),
        },
        ...prev,
      ])
    },
    [secretPath]
  )

  // "+" on a folder row: a new secret inside it, with the folder opened to show it
  const handleAddSecretIn = useCallback(
    (fullPath: string) => {
      setExpandedFolders((prev) => (prev.has(fullPath) ? prev : new Set(prev).add(fullPath)))
      handleAddNewClientSecret('', ApiSecretTypeChoices.Secret, '', fullPath)
    },
    [handleAddNewClientSecret]
  )

  const handleCreateSecretFromSearch = () => {
    handleAddNewClientSecret(normalizeKey(searchQuery))
    setSearchQuery('')
  }

  /**
   * Merges imported secrets into the client copy: existing keys get their
   * values (and comments) overwritten per env, new keys become new rows.
   */
  const bulkAddNewClientSecrets = useCallback(
    (imported: AppSecret[]) => {
      setClientAppSecrets((prev) => {
        // Imports land in the current folder, so only its keys can be overwritten
        const byKey = new Map(
          prev.filter((row) => (row.path ?? '/') === secretPath).map((row) => [row.key, row])
        )
        const updated = new Map<string, AppSecret>()
        const added: AppSecret[] = []

        for (const importedRow of imported) {
          const existing = byKey.get(importedRow.key)
          const envs = environmentsRef.current.map((env) => {
            const current = entryFor(existing, env.id)
            const incoming = entryFor(importedRow, env.id)?.secret
            if (!incoming) return current ?? { env, secret: null }
            if (current?.secret)
              return {
                ...current,
                secret: { ...current.secret, value: incoming.value, comment: incoming.comment },
              }
            return { env, secret: { ...incoming, key: importedRow.key, environment: env, path: secretPath } }
          })

          if (existing) updated.set(existing.id, { ...existing, envs })
          else added.push({ ...importedRow, path: secretPath, envs })
        }

        return [...prev.map((row) => updated.get(row.id) ?? row), ...added]
      })
    },
    [secretPath]
  )

  const handleDiscardChanges = () => setClientAppSecrets(serverAppSecrets)

  // ---- Rows shown in the grid: a tree of the current folder ----

  const isUnderRoot = useCallback(
    (path: string) => secretPath === '/' || path === secretPath || path.startsWith(`${secretPath}/`),
    [secretPath]
  )

  // Rows with a value in a checked env (server or client), plus brand-new rows
  const visibleRows = useMemo(
    () =>
      clientAppSecrets.filter((row) => {
        if (!isUnderRoot(row.path ?? '/')) return false
        const serverRow = serverAppSecretsById.get(row.id)
        if (!serverRow) return true
        return row.envs.some(
          (entry) =>
            checkedSet.has(entry.env.id!) &&
            (entry.secret !== null || Boolean(entryFor(serverRow, entry.env.id!)?.secret))
        )
      }),
    [clientAppSecrets, serverAppSecretsById, checkedSet, isUnderRoot]
  )

  const visibleFolders = useMemo(
    () =>
      appFolders.filter(
        (folder) =>
          isUnderRoot(folder.path) &&
          folder.envs.some((entry) => checkedSet.has(entry.env.id!) && entry.folder)
      ),
    [appFolders, checkedSet, isUnderRoot]
  )

  const visibleDynamicSecrets = useMemo(
    () =>
      appDynamicSecrets.filter(
        (ds) =>
          isUnderRoot(ds.path) &&
          ds.envs.some((entry) => checkedSet.has(entry.env.id) && entry.dynamicSecret)
      ),
    [appDynamicSecrets, checkedSet, isUnderRoot]
  )

  const parsedSearch = useMemo(() => parseSecretSearch(searchQuery), [searchQuery])
  // Any search text, qualifier or menu filter switches the tree to matches only
  const searching =
    filterIsActive(filter) ||
    parsedSearch.text.length > 0 ||
    hasRegularOnlyFacet(parsedSearch) ||
    parsedSearch.dynamic

  // Search and filters only consider the checked envs' values
  const matchingRows = useMemo(
    () =>
      visibleRows.filter((row) => {
        const projected = projectRow(row, checkedSet)
        return appSecretMatchesSearch(projected, parsedSearch) && appSecretMatchesFilter(projected, filter)
      }),
    [visibleRows, checkedSet, parsedSearch, filter]
  )

  const matchingDynamicSecrets = useMemo(
    () =>
      showDynamicUnderFilter(filter)
        ? visibleDynamicSecrets.filter((ds) =>
            dynamicMatchesSearch(dynamicSearchText(ds.name), parsedSearch)
          )
        : [],
    [visibleDynamicSecrets, parsedSearch, filter]
  )

  const availableTags = useMemo(
    () => collectAppSecretTags(visibleRows.map((row) => projectRow(row, checkedSet))),
    [visibleRows, checkedSet]
  )

  const duplicateRowIds = useMemo(() => duplicateKeyRowIds(clientAppSecrets), [clientAppSecrets])

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

  // The tree in render order. Each folder level lists its subfolders (each followed by
  // its contents when expanded), then dynamic-secret groups, then secrets and rotating
  // groups in sort order. Row numbers restart in each folder.
  const treeItems = useMemo<TreeItem[]>(() => {
    const rows = searching ? matchingRows : visibleRows
    const dynamics = searching ? matchingDynamicSecrets : visibleDynamicSecrets

    let folders = visibleFolders
    let openPaths = expandedFolders
    if (searching) {
      // Folders on the way to a match (opened), plus folders whose name matches plain text
      const leading = new Set<string>()
      const addAncestors = (path: string) => {
        for (let p = path; p !== secretPath && p !== '/'; p = parentPath(p)) leading.add(p)
      }
      rows.forEach((row) => addAncestors(row.path ?? '/'))
      dynamics.forEach((ds) => addAncestors(ds.path))
      const plainText =
        !filterIsActive(filter) && !hasRegularOnlyFacet(parsedSearch) && !parsedSearch.dynamic
      folders = visibleFolders.filter(
        (folder) =>
          leading.has(folderFullPath(folder)) ||
          (plainText &&
            parsedSearch.text.every((token) => folder.name.toLowerCase().includes(token)))
      )
      openPaths = new Set([...expandedFolders, ...leading])
    }

    const foldersByParent = groupBy(folders, (folder) => folder.path)
    const rowsByPath = groupBy(rows, (row) => row.path ?? '/')
    const dynamicsByPath = groupBy(dynamics, (ds) => ds.path)

    const items: TreeItem[] = []
    const walk = (path: string, depth: number) => {
      const levelFolders = [...(foldersByParent.get(path) ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name)
      )
      for (const folder of levelFolders) {
        const fullPath = folderFullPath(folder)
        const expanded = openPaths.has(fullPath)
        items.push({ kind: 'folder', folder, fullPath, depth, expanded })
        if (expanded) walk(fullPath, depth + 1)
      }

      for (const appDynamicSecret of dynamicsByPath.get(path) ?? []) {
        const sourceDs = appDynamicSecret.envs.find((e) => e.dynamicSecret !== null)?.dynamicSecret
        const keyMap = (
          (sourceDs?.keyMap ?? []) as Array<{ id?: string | null; keyName?: string | null } | null>
        ).flatMap((k) => (k && k.id && k.keyName ? [{ id: k.id, keyName: k.keyName }] : []))
        items.push({ kind: 'dynamicGroup', appDynamicSecret, keyMap, depth })
      }

      const levelRows = rowsByPath.get(path) ?? []
      const byId = new Map(levelRows.map((row) => [row.id, row]))
      const sorted = sortAppSecrets(
        levelRows.map((row) => projectRow(row, checkedSet)),
        sort
      ).map((projected) => byId.get(projected.id)!)
      for (const item of groupRotatingRows(sorted, checkedSet)) items.push({ ...item, depth })
    }
    walk(secretPath, 0)
    return items
  }, [
    searching,
    matchingRows,
    visibleRows,
    matchingDynamicSecrets,
    visibleDynamicSecrets,
    visibleFolders,
    expandedFolders,
    secretPath,
    filter,
    parsedSearch,
    checkedSet,
    sort,
  ])

  // The key column fits the longest key or folder name on screen, indent included
  // ...and its secret rows' hover menus: they start after the row's indent and show its tags
  const { longestKeyChars, longestFolderChars, maxRowDepth, maxTagCount } = useMemo(() => {
    let keys = 0
    let folders = 0
    let depth = 0
    let tags = 0
    const measureRow = (row: AppSecret, rowDepth: number) => {
      keys = Math.max(keys, row.key.length + rowDepth * INDENT_CHARS)
      depth = Math.max(depth, rowDepth)
      for (const entry of row.envs)
        if (checkedSet.has(entry.env.id!)) tags = Math.max(tags, entry.secret?.tags?.length ?? 0)
    }
    for (const item of treeItems) {
      const indent = item.depth * INDENT_CHARS
      if (item.kind === 'folder') folders = Math.max(folders, item.folder.name.length + indent)
      else if (item.kind === 'single') measureRow(item.secret, item.depth)
      else if (item.kind === 'group') item.appSecrets.forEach((row) => measureRow(row, item.depth))
      else item.keyMap.forEach((k) => (keys = Math.max(keys, k.keyName.length + indent)))
    }
    return { longestKeyChars: keys, longestFolderChars: folders, maxRowDepth: depth, maxTagCount: tags }
  }, [treeItems, checkedSet])
  // Deferred: a new longest key widens the column at idle, not on every keystroke
  const deferredLongestKeyChars = useDeferredValue(longestKeyChars)
  // Column widths the user dragged: per env (hidden envs keep theirs), and this app's key column
  const { widths: columnWidths, setWidth: setColumnWidth } = useColumnWidths()
  const keyColumn = keyColumnId(app)

  // The last column is the new-environment action, wider when it carries a plan label
  const maxEnvsPerApp = organisation?.planDetail?.maxEnvsPerApp
  const newEnvPaywalled = Boolean(maxEnvsPerApp) && environments.length >= maxEnvsPerApp!
  const trailingRem = !userCanCreateEnvironments
    ? TRAILING_REM
    : newEnvPaywalled
      ? NEW_ENV_COLUMN_UPSELL_REM
      : NEW_ENV_COLUMN_REM

  const layoutFor = (widths: Record<string, number>) =>
    gridLayout({
      checkedCount: checkedSet.size,
      slimCount: columns.length - checkedSet.size,
      viewportWidth: viewport.width,
      rootFontPx: viewport.rootFontPx,
      longestKeyChars: deferredLongestKeyChars,
      longestFolderChars,
      maxRowDepth,
      maxTagCount,
      customWidthsPx: checkedEnvironments.flatMap((env) =>
        widths[env.id] !== undefined ? [widths[env.id]] : []
      ),
      customKeyPx: widths[keyColumn],
      trailingRem,
    })
  const layout = layoutFor(columnWidths)
  const layoutForRef = useRef(layoutFor)
  layoutForRef.current = layoutFor
  const columnWidthsRef = useRef(columnWidths)
  columnWidthsRef.current = columnWidths

  // While a header is dragged the table is resized directly — no render per pointer move
  const handleResizePreview = useCallback(
    (columnId: string, px: number) => {
      const table = gridScrollerRef.current?.querySelector('table')
      const col = table?.querySelector<HTMLTableColElement>(`col[data-col-id="${columnId}"]`)
      if (!table || !col) return
      const preview = layoutForRef.current({ ...columnWidthsRef.current, [columnId]: px })
      col.style.width = columnId === keyColumn ? preview.keyColumnWidth : `${clampColumnPx(px)}px`
      table.style.minWidth = preview.tableMinWidth
      table.style.width = preview.tableWidth
    },
    [keyColumn]
  )

  // Hovering a cell lights up its env's header (and, via CSS, its row's key): set on the DOM
  // directly so moving the pointer never re-renders the grid
  const hoveredHeaderRef = useRef<HTMLElement | null>(null)
  const markHoveredHeader = (th: HTMLElement | null) => {
    if (hoveredHeaderRef.current === th) return
    hoveredHeaderRef.current?.removeAttribute('data-hovered')
    th?.setAttribute('data-hovered', '')
    hoveredHeaderRef.current = th
  }
  const handleGridMouseOver = (e: React.MouseEvent<HTMLTableElement>) => {
    const cell = (e.target as HTMLElement).closest('td')
    const row = cell?.parentElement as HTMLTableRowElement | null | undefined
    const header = e.currentTarget.tHead?.rows[0]
    // Rows with spanning cells (group headers, the empty state) don't line up with the header
    const lined = cell && row && header && row.cells.length === header.cells.length
    const isEnvCell = lined && cell.cellIndex > 0 && cell.cellIndex < header.cells.length - 1
    markHoveredHeader(isEnvCell ? header.cells[cell.cellIndex] : null)
  }

  const newEnvironmentRef = useRef<CreateEnvironmentDialogHandle>(null)
  // Any cell of the new-environment column opens the dialog
  const handleGridClick = (e: React.MouseEvent<HTMLTableElement>) => {
    const target = e.target as HTMLElement
    if (target.closest('button, a, input, textarea')) return
    if (target.closest('[data-new-env-cell]')) newEnvironmentRef.current?.openModal()
  }

  const { data: syncsData } = useQuery(GetAppSyncStatus, {
    variables: { appId: app },
    skip: !userCanReadSyncs,
    pollInterval: unsavedChanges ? 0 : 5000,
  })

  // ---- Deep links: ?secret=<id> scrolls to and flashes that value ----

  const secretToHighlight = searchParams?.get('secret') ?? null
  const [highlight, setHighlight] = useState<{ rowId: string; envId: string } | null>(null)
  const lastHighlightedRef = useRef<string | null>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    // Polls re-run this effect, so the target is remembered to flash only once
    if (!secretToHighlight || lastHighlightedRef.current === secretToHighlight) return
    for (const row of serverAppSecrets) {
      const entry = row.envs.find((e) => e.secret?.id === secretToHighlight)
      if (!entry) continue
      lastHighlightedRef.current = secretToHighlight
      setHighlight({ rowId: row.id, envId: entry.env.id! })
      clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = setTimeout(() => setHighlight(null), 2000)
      return
    }
  }, [secretToHighlight, serverAppSecrets])
  useEffect(() => () => clearTimeout(highlightTimerRef.current), [])

  // ---- Env columns: selection, order, export ----

  const handleToggleEnv = useCallback((envId: string) => toggleEnv(envId, allEnvIds), [toggleEnv, allEnvIds])
  const handleSoloEnv = useCallback((envId: string) => soloEnv(envId, allEnvIds), [soloEnv, allEnvIds])

  const allowEnvReordering =
    organisation?.plan !== ApiOrganisationPlanChoices.Fr &&
    userCanUpdateEnvironments &&
    orderedEnvironments.length > 1

  const saveEnvOrder = useCallback(
    async (nextOrder: string[]) => {
      setEnvOrderOverride(nextOrder)
      try {
        await updateEnvOrder({
          variables: { appId: app, environmentOrder: nextOrder },
          refetchQueries: [{ query: GetAppEnvironments, variables: { appId: app } }],
          awaitRefetchQueries: true,
        })
        // Unsaved edits survive: the refetch is rebased like any other snapshot
        await refetch()
      } catch (e) {
        setEnvOrderOverride(null)
        toast.error('Failed to update environment order')
      }
    },
    [app, updateEnvOrder, refetch]
  )

  const handleMoveEnv = useCallback(
    (envId: string, direction: 'left' | 'right') => {
      const from = allEnvIds.indexOf(envId)
      const to = direction === 'left' ? from - 1 : from + 1
      if (from === -1 || to < 0 || to >= allEnvIds.length) return
      const nextOrder = [...allEnvIds]
      ;[nextOrder[from], nextOrder[to]] = [nextOrder[to], nextOrder[from]]
      saveEnvOrder(nextOrder)
    },
    [allEnvIds, saveEnvOrder]
  )

  // A header dragged onto another env's header lands before or after it
  const handleDropEnv = useCallback(
    (envId: string, targetEnvId: string, after: boolean) => {
      const nextOrder = allEnvIds.filter((id) => id !== envId)
      const at = nextOrder.indexOf(targetEnvId)
      if (envId === targetEnvId || at === -1) return
      nextOrder.splice(after ? at + 1 : at, 0, envId)
      if (!arraysEqual(nextOrder, allEnvIds)) saveEnvOrder(nextOrder)
    },
    [allEnvIds, saveEnvOrder]
  )

  const handleExportEnv = useCallback(
    (envId: string) => {
      const env = environmentsRef.current.find((e) => e.id === envId)
      if (!env) return
      const secrets = Array.from(serverByIdRef.current.values()).flatMap((row) => {
        const secret = entryFor(row, envId)?.secret
        return secret ? [{ ...secret, key: secret.key || row.key }] : []
      })
      exportToEnvFile(secrets, appName ?? 'app', env.name, secretPath)
      const ids = secrets.map((secret) => secret.id)
      if (ids.length > 0) readSecrets({ variables: { ids } })
    },
    [appName, secretPath, readSecrets]
  )

  const toggleGlobalReveal = () => {
    if (globallyRevealed) {
      setGloballyRevealed(false)
      return
    }
    setGloballyRevealed(true)
    const ids = visibleRows.flatMap((row) =>
      row.envs
        .filter(
          (entry) =>
            checkedSet.has(entry.env.id!) && entry.secret && !entry.secret.id.startsWith('new-')
        )
        .map((entry) => entry.secret!.id)
    )
    if (ids.length > 0) readSecrets({ variables: { ids } })
  }

  // ---- Deploy ----

  /**
   * Encrypts every new or modified value with its env's keys and sends one
   * bulk create/update/delete. Values are only ever in the checked envs.
   */
  const handleBulkUpdateSecrets = async () => {
    const userKxKeys = {
      publicKey: await getUserKxPublicKey(keyring!.publicKey),
      privateKey: await getUserKxPrivateKey(keyring!.privateKey),
    }

    // One salt decrypt per env, and only for envs that actually have changes
    const saltByEnv = new Map<string, Promise<string>>()
    const saltFor = (env: EnvironmentType) => {
      let salt = saltByEnv.get(env.id)
      if (!salt) {
        salt = decryptAsymmetric(env.wrappedSalt!, userKxKeys.privateKey, userKxKeys.publicKey)
        saltByEnv.set(env.id, salt)
      }
      return salt
    }

    const serverSecretsById = new Map(flattenAppSecrets(serverAppSecrets).map((s) => [s.id, s]))
    const secretsToCreate: SecretInput[] = []
    const secretsToUpdate: SecretInput[] = []

    await Promise.all(
      flattenAppSecrets(clientAppSecrets).map(async (clientSecret) => {
        if ((clientSecret as SecretWithFlags).stagedForDelete) return
        const { id, key, value, comment, tags } = clientSecret
        const isNewSecret = id.startsWith('new-')
        const serverSecret = serverSecretsById.get(id)

        const isModified =
          !isNewSecret &&
          serverSecret &&
          (serverSecret.key !== key ||
            serverSecret.value !== value ||
            serverSecret.type !== clientSecret.type ||
            (serverSecret.comment ?? '') !== (comment ?? '') ||
            !areTagsAreSame(serverSecret.tags ?? [], tags ?? []))
        if (!isNewSecret && !isModified) return

        const env = clientSecret.environment
        const [encryptedKey, encryptedValue, encryptedComment, keyDigest] = await Promise.all([
          encryptAsymmetric(key, env.identityKey),
          encryptAsymmetric(value, env.identityKey),
          encryptAsymmetric(comment || '', env.identityKey),
          saltFor(env).then((salt) => digest(key, salt)),
        ])

        const secretInput: SecretInput = {
          envId: env.id,
          path: clientSecret.path || secretPath,
          key: encryptedKey,
          keyDigest,
          value: encryptedValue,
          comment: encryptedComment,
          tags: (tags ?? []).map((tag) => tag.id),
          type: clientSecret.type?.toLowerCase() || 'secret',
        }

        if (isNewSecret) secretsToCreate.push(secretInput)
        else secretsToUpdate.push({ ...secretInput, id })
      })
    )

    if (secretsToCreate.length > 0 || secretsToUpdate.length > 0 || secretsToDelete.length > 0) {
      const { errors } = await bulkProcessSecrets({
        variables: { secretsToCreate, secretsToUpdate, secretsToDelete },
        refetchQueries: [{ query: GetAppSyncStatus, variables: { appId: app } }],
      })

      // The refetched snapshot replaces the client copy outright: its new
      // values now have real ids, which a rebase would read as fresh edits
      if (!errors) resetOnNextPublishRef.current = true
      await refetch()
    }
  }

  const deployAndToast = async () => {
    setIsLoading(true)
    try {
      await handleBulkUpdateSecrets()
      toast.success('Changes successfully deployed.')
    } finally {
      setIsLoading(false)
    }
  }

  // Validation, then deploy
  const handleSaveChanges = async () => {
    const activeRows = clientAppSecrets.filter((row) =>
      row.envs.some((entry) => entry.secret && !(entry.secret as SecretWithFlags).stagedForDelete)
    )

    if (activeRows.some((row) => row.key === '')) {
      toast.error('Secret keys cannot be empty!')
      return false
    }

    if (duplicateRowIds.size > 0) {
      toast.error('Secret keys cannot be repeated!')
      return false
    }

    // Validate secret references in the values being deployed
    const refErrors = validateSecretReferences(
      activeRows.map((row) => projectRow(row, checkedSet)),
      referenceContext
    )
    if (refErrors.length > 0) {
      setRefWarnings(refErrors)
      refWarningDialogRef.current?.openModal()
      return false
    }

    await deployAndToast()
  }

  const handleSaveWithBrokenRefs = async () => {
    refWarningDialogRef.current?.closeModal()
    setRefWarnings([])
    await deployAndToast()
  }

  // Flattened views of the app secrets, used for the deploy preview
  const flatClientSecrets = useMemo(() => flattenAppSecrets(clientAppSecrets), [clientAppSecrets])
  const flatServerSecrets = useMemo(() => flattenAppSecrets(serverAppSecrets), [serverAppSecrets])

  // ---- Folders ----

  // "Add folder" in an env that's missing it; the server creates any missing parents
  const handleAddFolderIn = useCallback(
    async (folder: AppFolder, env: EnvironmentType) => {
      try {
        await createFolder({ variables: { envId: env.id, name: folder.name, path: folder.path } })
        toast.success(`Created ${folder.name} in ${env.name}`, { autoClose: 2000 })
        refetch()
      } catch {
        // The Apollo error link has already shown the error
      }
    },
    [createFolder, refetch]
  )

  // Deleting a folder removes it, and everything in it, from the envs picked in the dialog
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<FolderDeleteTarget | null>(null)
  const folderDataRef = useRef({ clientAppSecrets, serverAppSecretsById, appFolders, appDynamicSecrets, orderedEnvironments })
  folderDataRef.current = { clientAppSecrets, serverAppSecretsById, appFolders, appDynamicSecrets, orderedEnvironments }

  const handleRequestDeleteFolder = useCallback((folder: AppFolder, fullPath: string) => {
    const data = folderDataRef.current
    const inside = (path?: string | null) => {
      const p = path ?? '/'
      return p === fullPath || p.startsWith(`${fullPath}/`)
    }
    const envs: FolderInEnv[] = data.orderedEnvironments.flatMap((env) => {
      const folderInEnv = folder.envs.find((entry) => entry.env.id === env.id)?.folder
      if (!folderInEnv) return []
      const secretCount =
        [...data.serverAppSecretsById.values()].filter(
          (row) => inside(row.path) && entryFor(row, env.id)?.secret
        ).length +
        data.appDynamicSecrets.filter(
          (ds) =>
            inside(ds.path) && ds.envs.some((entry) => entry.env.id === env.id && entry.dynamicSecret)
        ).length
      const folderCount = data.appFolders.filter(
        (sub) => inside(sub.path) && sub.envs.some((entry) => entry.env.id === env.id && entry.folder)
      ).length
      return [{ env, folderId: folderInEnv.id, secretCount, folderCount }]
    })
    setFolderDeleteTarget({
      name: folder.name,
      fullPath,
      envs,
      hasUnsavedChanges: data.clientAppSecrets.some(
        (row) => inside(row.path) && appSecretRowIsEdited(data.serverAppSecretsById.get(row.id), row)
      ),
    })
  }, [])

  const handleDeleteFolders = async (folders: FolderInEnv[]) => {
    if (!folderDeleteTarget) return
    const { name, fullPath } = folderDeleteTarget
    const results = await Promise.allSettled(
      folders.map(({ folderId }) => deleteFolder({ variables: { folderId } }))
    )
    const deleted = results.filter((result) => result.status === 'fulfilled').length
    if (deleted > 0)
      toast.success(`Deleted ${name} from ${deleted} environment${deleted === 1 ? '' : 's'}`)
    if (deleted < folders.length)
      toast.error(`Couldn't delete ${name} from ${folders.length - deleted} environment(s)`)
    setExpandedFolders(
      (prev) =>
        new Set([...prev].filter((path) => path !== fullPath && !path.startsWith(`${fullPath}/`)))
    )
    setFolderDeleteTarget(null)
    refetch()
  }

  const [newFolderName, setNewFolderName] = useState('')

  const handleUpdateNewFolderName = (name: string) => {
    if (FOLDER_NAME_REGEX.test(name)) setNewFolderName(name)
  }

  // Creates the folder at the current path in every checked env. Envs where it
  // already exists are skipped by the server-side unique check.
  const handleCreateFolder = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (isReservedFolderName(newFolderName, secretPath)) {
      toast.error(`"${newFolderName}" is a reserved name and cannot be used for root folders`)
      return
    }

    const results = await Promise.allSettled(
      checkedEnvironments.map((env) =>
        createFolder({ variables: { envId: env.id, name: newFolderName, path: secretPath } })
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

  const checkedLabel =
    checkedEnvironments.length === 1
      ? checkedEnvironments[0].name
      : checkedEnvironments.length === orderedEnvironments.length
        ? 'all Environments'
        : `${checkedEnvironments.length} Environments`

  const viewTitle =
    checkedEnvironments.length === 1
      ? checkedEnvironments[0].name
      : checkedEnvironments.length === orderedEnvironments.length
        ? 'All Environments'
        : `${checkedEnvironments.length} of ${orderedEnvironments.length} Environments`

  // A render helper, not a component: an inline component type would remount (and close) every render
  const renderExportControl = () =>
    checkedEnvironments.length === 1 ? (
      <Button
        variant="outline"
        onClick={() => handleExportEnv(checkedEnvironments[0].id)}
        title={`Download ${checkedEnvironments[0].name} as a .env file`}
      >
        <div className="flex items-center gap-2">
          <FaDownload />{' '}
          <span className="hidden sm:inline">
            <span className="hidden xl:inline">Export as </span>.env
          </span>
        </div>
      </Button>
    ) : (
      <Menu as="div" className="relative">
        <Menu.Button as={Fragment}>
          <Button variant="outline" title="Download an environment as a .env file">
            <div className="flex items-center gap-2">
              <FaDownload />
              <span className="hidden sm:inline">
                <span className="hidden xl:inline">Export as </span>.env
              </span>
              <FaChevronDown className="text-3xs opacity-70" />
            </div>
          </Button>
        </Menu.Button>
        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="transform opacity-0 scale-95"
          enterTo="transform opacity-100 scale-100"
          leave="transition ease-in duration-75"
          leaveFrom="transform opacity-100 scale-100"
          leaveTo="transform opacity-0 scale-95"
        >
          <Menu.Items
            anchor={{ to: 'bottom end', gap: 4 }}
            className="z-50 min-w-[10rem] rounded-md bg-zinc-100 p-1 text-xs text-zinc-900 shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none dark:bg-zinc-800 dark:text-zinc-100"
          >
            {checkedEnvironments.map((env) => (
              <Menu.Item key={env.id}>
                {({ focus }) => (
                  <button
                    type="button"
                    onClick={() => handleExportEnv(env.id)}
                    className={clsx(
                      'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left',
                      focus && 'bg-zinc-200 dark:bg-zinc-700'
                    )}
                  >
                    <FaDownload className="text-2xs text-neutral-500" />
                    {env.name}
                  </button>
                )}
              </Menu.Item>
            ))}
          </Menu.Items>
        </Transition>
      </Menu>
    )

  const newSecretMenu = userCanCreateSecrets ? (
    <SplitButton
      variant="primary"
      aria-label="New Secret"
      onClick={() => handleAddNewClientSecret()}
      menuContent={
        <div className="w-max flex flex-col items-start gap-1">
          <Button
            variant="secondary"
            onClick={() => handleAddNewClientSecret('', ApiSecretTypeChoices.Secret, '${')}
          >
            <div className="flex items-center gap-2">
              <FaLink /> Reference a secret
            </div>
          </Button>
          <Button variant="secondary" onClick={() => newFolderDialogRef.current?.openModal()}>
            <div className="flex items-center gap-2">
              <FaFolderPlus /> New Folder
            </div>
          </Button>
          <Button variant="secondary" onClick={() => importDialogRef.current?.openModal()}>
            <div className="flex items-center gap-2">
              <TbDownload /> Import secrets
            </div>
          </Button>
        </div>
      }
    >
      <FaPlus />{' '}
      <span className="hidden sm:inline">
        <span className="hidden xl:inline">New </span>Secret
      </span>
    </SplitButton>
  ) : (
    <Button variant="secondary" onClick={() => importDialogRef.current?.openModal()}>
      <TbDownload /> Import secrets
    </Button>
  )

  const skeletonLayout = gridLayout({
    checkedCount: 3,
    slimCount: 0,
    viewportWidth: viewport.width,
    rootFontPx: viewport.rootFontPx,
    longestKeyChars: 24,
    longestFolderChars: 0,
    maxRowDepth: 0,
    maxTagCount: 0,
    customWidthsPx: [],
    trailingRem: TRAILING_REM,
  })

  // Row elements are reused while nothing a row shows has changed: React skips a reused
  // element outright, so a keystroke re-renders one row instead of every row's props
  const rowElementsRef = useRef<{ shared: unknown[]; rows: Map<string, CachedRow> }>({
    shared: [],
    rows: new Map(),
  })

  const hasResults = treeItems.length > 0
  // Judged on the checked envs: hidden envs' secrets aren't in the grid
  const hasContent =
    visibleRows.length > 0 || visibleFolders.length > 0 || visibleDynamicSecrets.length > 0
  const colSpan = columns.length + 2

  const renderSecretRows = () => {
    // Props every row shares; any change rebuilds every row element
    const shared = [
      columns,
      revealOnHover,
      globallyRevealed,
      userCanUpdateSecrets,
      userCanDeleteSecrets,
      handleUpdateSecretKey,
      handleUpdateSecretType,
      handleUpdateSecretTags,
      handleUpdateSecretComment,
      handleUpdateSecretValue,
      handleAddNewEnvValue,
      stageEnvValueForDelete,
      handleStageClientSecretForDelete,
      handleToggleEnv,
      logSecretReads,
    ]
    const cache = rowElementsRef.current
    const previous = sameItems(shared, cache.shared) ? cache.rows : new Map<string, CachedRow>()
    const rows = new Map<string, CachedRow>()
    rowElementsRef.current = { shared, rows }

    // Row numbers count within each folder: expanding one doesn't renumber the rows around it
    const counters = new Map<string, number>()
    const nextIndex = (path: string | undefined) => {
      const key = path ?? '/'
      const index = counters.get(key) ?? 0
      counters.set(key, index + 1)
      return index
    }
    const renderRow = (appSecret: AppSecret, depth: number) => {
      const index = nextIndex(appSecret.path)
      const serverAppSecret = serverAppSecretsById.get(appSecret.id)
      const isDuplicate = duplicateRowIds.has(appSecret.id)
      const highlightedEnvId = highlight?.rowId === appSecret.id ? highlight.envId : null
      const deps = [appSecret, serverAppSecret, depth, index, isDuplicate, highlightedEnvId]

      const cached = previous.get(appSecret.id)
      const element =
        cached && sameItems(cached.deps, deps) ? (
          cached.element
        ) : (
          <AppSecretRow
            key={appSecret.id}
            index={index}
            depth={depth}
            clientAppSecret={appSecret}
            serverAppSecret={serverAppSecret}
            columns={columns}
            isDuplicate={isDuplicate}
            revealOnHover={revealOnHover}
            globallyRevealed={globallyRevealed}
            highlightedEnvId={highlightedEnvId}
            canUpdateSecrets={userCanUpdateSecrets}
            canDeleteSecrets={userCanDeleteSecrets}
            updateKey={handleUpdateSecretKey}
            updateType={handleUpdateSecretType}
            updateTags={handleUpdateSecretTags}
            updateComment={handleUpdateSecretComment}
            updateValue={handleUpdateSecretValue}
            addEnvValue={handleAddNewEnvValue}
            deleteEnvValue={stageEnvValueForDelete}
            deleteKey={handleStageClientSecretForDelete}
            showEnv={handleToggleEnv}
            logReads={logSecretReads}
          />
        )
      rows.set(appSecret.id, { deps, element })
      return element
    }

    return treeItems.map((item) => {
      if (item.kind === 'folder')
        return (
          <AppFolderRow
            key={`folder:${item.fullPath}`}
            appFolder={item.folder}
            fullPath={item.fullPath}
            depth={item.depth}
            expanded={item.expanded}
            onToggle={toggleFolder}
            href={withEnvSelection(`${basePath}${item.fullPath}`)}
            columns={columns}
            showEnv={handleToggleEnv}
            addFolderIn={userCanCreateSecrets ? handleAddFolderIn : undefined}
            deleteFolder={userCanDeleteSecrets ? handleRequestDeleteFolder : undefined}
            addSecretIn={userCanCreateSecrets ? handleAddSecretIn : undefined}
          />
        )
      if (item.kind === 'single') return renderRow(item.secret, item.depth)
      if (item.kind === 'dynamicGroup') {
        const headDs = item.appDynamicSecret.envs.find((e) => e.dynamicSecret !== null)?.dynamicSecret
        return (
          <AppDynamicSecretGroup
            key={`dgroup-${item.appDynamicSecret.id}`}
            depth={item.depth}
            environments={orderedEnvironments}
            perEnvDynamicSecrets={item.appDynamicSecret.envs}
            displayName={item.appDynamicSecret.name}
            providerId={headDs?.provider ?? null}
            colSpan={colSpan}
            team={team}
            app={app}
            canSetUpIn={() => userCanCreateSecrets}
          >
            {item.keyMap.map((k) => (
              <AppDynamicSecretKeyRow
                key={`${item.appDynamicSecret.id}-${k.id}`}
                index={nextIndex(item.appDynamicSecret.path)}
                depth={item.depth}
                keyName={k.keyName}
                envs={item.appDynamicSecret.envs}
                columns={columns}
                showEnv={handleToggleEnv}
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
          depth={item.depth}
          groupRotatingSecrets={groupRotatingSecrets}
          environments={orderedEnvironments}
          colSpan={colSpan}
          team={team}
          app={app}
          canSetUpIn={() => userCanCreateRotation}
        >
          {item.appSecrets.map((s) => renderRow(s, item.depth))}
        </AppRotatingSecretGroup>
      )
    })
  }

  const renderEmptyState = () => {
    if (hasContent || searchQuery) {
      const menuActive = filterIsActive(filter)
      const hasQualifiers = hasRegularOnlyFacet(parsedSearch) || parsedSearch.dynamic
      // A plain keyword search (no menu filter, no qualifiers) still offers "Create".
      const pureTextSearch = searchQuery.trim() !== '' && !menuActive && !hasQualifiers
      return (
        <EmptyState
          title={pureTextSearch ? `No results for "${searchQuery}"` : 'No matching secrets'}
          subtitle={
            pureTextSearch ? 'Try adjusting your search term' : 'Try adjusting your search or filters'
          }
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <MdSearchOff />
            </div>
          }
        >
          {pureTextSearch ? (
            userCanCreateSecrets && (
              <div className="mt-4">
                <Button variant="primary" onClick={handleCreateSecretFromSearch}>
                  <FaPlus /> Create &quot;{normalizeKey(searchQuery)}&quot;
                </Button>
              </div>
            )
          ) : (
            <div className="mt-4">
              <Button
                variant="primary"
                onClick={() => {
                  setFilter(EMPTY_SECRET_FILTER)
                  setSearchQuery('')
                }}
              >
                <FaXmark /> Clear filters
              </Button>
            </div>
          )}
        </EmptyState>
      )
    }

    return (
      <EmptyState
        title="No secrets"
        subtitle={`There are no secrets in ${checkedLabel} here yet. Add a secret or a folder, or import a .env file.`}
        graphic={
          <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
            <MdPassword />
          </div>
        }
      >
        {userCanCreateSecrets && (
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => importDialogRef.current?.openModal()}>
              <TbDownload /> Import secrets
            </Button>
            <Button variant="outline" onClick={() => newFolderDialogRef.current?.openModal()}>
              <FaFolderPlus /> New Folder
            </Button>
            <Button variant="primary" onClick={() => handleAddNewClientSecret()}>
              <FaPlus /> New Secret
            </Button>
          </div>
        )}
      </EmptyState>
    )
  }

  return (
    <SecretReferenceContext.Provider value={liveReferenceContext}>
      {/* Flex column so the grid wrapper (flex-1) is the only scrolling region —
          search/deploy/toolbar stay pinned above it */}
      <section className="space-y-4 flex flex-col flex-1 min-h-0">
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 lg:gap-6 justify-between w-full">
          <div className="flex flex-wrap min-w-0 items-center gap-3 sm:gap-4 lg:gap-6">
            <div className="flex items-baseline gap-2">
              <h1 className="h3 font-semibold text-base" id="secrets">
                {viewTitle}
              </h1>
              {checkedEnvironments.length < orderedEnvironments.length && (
                <button
                  type="button"
                  onClick={showAllEnvs}
                  className="whitespace-nowrap text-xs text-emerald-600 hover:underline dark:text-emerald-400"
                  title="Show every environment"
                >
                  Show all
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <PathBreadcrumbs basePath={basePath} path={pathSegments} buildHref={withEnvSelection} />
            </div>
          </div>
          <div>
            {unsavedChanges && (
              <DeployPreview
                clientSecrets={flatClientSecrets}
                serverSecrets={flatServerSecrets}
                secretsToDelete={secretsToDelete}
                showEnvironment
                showPath
              />
            )}
          </div>
        </div>

        <div className="flex w-full flex-col items-stretch justify-between gap-2 border-b border-neutral-500/20 pb-4 md:flex-row md:items-center">
          <div className="flex min-w-0 items-center gap-2">
            <div className="relative flex min-w-0 flex-1 items-center rounded-md bg-zinc-100 px-2 dark:bg-zinc-800 md:flex-initial">
              <div className="">
                <FaSearch className="text-neutral-500" />
              </div>
              <input
                placeholder="Search keys or values"
                className="custom min-w-0 w-full bg-zinc-100 dark:bg-zinc-800 placeholder:text-neutral-500 text-2xs 2xl:text-xs md:w-auto"
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
            <div className="relative shrink-0">
              <FilterMenu filter={filter} setFilter={setFilter} availableTags={availableTags} />
            </div>
            <div className="relative shrink-0">
              <SortMenu sort={sort} setSort={setSort} />
            </div>
          </div>

          <div className="flex flex-col items-end gap-4 sm:pr-4">
            <div className="flex gap-2 items-center">
              {unsavedChanges && (
                <Button variant="outline" onClick={handleDiscardChanges} title="Discard changes">
                  <span className="px-2 py-1">
                    <FaUndo className="text-lg" />
                  </span>
                  <span>
                    Discard<span className="hidden xl:inline"> changes</span>
                  </span>
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

        {checkedEnvironments.length > 0 && (
          <MultiEnvImportDialog
            environments={checkedEnvironments}
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
              in {checkedLabel}.
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

        {hasContent && (
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2 sm:gap-4">
              <Button
                variant="outline"
                onClick={toggleGlobalReveal}
                aria-label={globallyRevealed ? 'Mask all' : 'Reveal all'}
                title={globallyRevealed ? 'Mask all' : 'Reveal all'}
              >
                <div className="flex items-center gap-2">
                  {globallyRevealed ? <FaEyeSlash /> : <FaEye />}
                  <span className="hidden xl:inline">
                    {globallyRevealed ? 'Mask all' : 'Reveal all'}
                  </span>
                </div>
              </Button>

              <label className="flex items-center gap-2 sm:pl-2 sm:border-l border-neutral-500/20 cursor-pointer select-none">
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
            <div className="flex justify-end gap-2 sm:gap-4 sm:pr-4">
              {renderExportControl()}
              {newSecretMenu}
            </div>
          </div>
        )}

        {fetching && !hasContent ? (
          <div className="isolate flex-1 min-h-0 overflow-auto">
            <table className={GRID_TABLE} style={{ minWidth: skeletonLayout.tableMinWidth }}>
              <colgroup>
                <col style={{ width: skeletonLayout.keyColumnWidth }} />
                <col />
                <col />
                <col />
                <col style={{ width: `${TRAILING_REM}rem` }} />
              </colgroup>
              <thead>
                <tr>
                  {[...Array(5)].map((_, i) => (
                    <th
                      key={i}
                      className={clsx(
                        'sticky top-0 border-b border-r border-neutral-500/20 p-0',
                        i === 0 ? clsx(GRID_HEADER_BG_SOLID, 'left-0 z-40') : GRID_HEADER_BG
                      )}
                    >
                      <div className="flex h-9 items-center px-3">
                        {i > 0 && i < 4 && (
                          <div className="h-3 w-24 animate-pulse rounded-full bg-zinc-300 dark:bg-zinc-700" />
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...Array(13)].map((_, index) => (
                  <AppSecretRowSkeleton key={`skeleton-${index}`} index={index} envCount={3} />
                ))}
              </tbody>
            </table>
          </div>
        ) : !userCanReadEnvironments || !userCanReadSecrets ? (
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
        ) : (
          // The scroller is the only scrolling region, on both axes: headers stick to
          // its top and the key column to its left edge. `isolate` keeps the sticky
          // cells' z-indices below dialogs; its inline size centers the empty states.
          // The wrapper hosts the sideways-scroll cues, which mustn't scroll with it.
          <div className="relative flex min-h-0 flex-1 flex-col">
          <div
            ref={gridScrollerRef}
            className="isolate min-h-0 flex-1 overflow-auto [container-type:inline-size]"
            // Focus and scrollIntoView keep fields clear of the sticky header, the key
            // column and the scroll-right pill
            style={{
              scrollPaddingTop: '2.5rem',
              scrollPaddingLeft: layout.keyColumnWidth,
              scrollPaddingRight: '3rem',
            }}
          >
            <table
              className={clsx(
                GRID_TABLE,
                // The new-environment column lights up as one button
                userCanCreateEnvironments &&
                  '[&_[data-new-env-cell]]:cursor-pointer [&:has([data-new-env-cell]:hover)_[data-new-env-cell]]:bg-zinc-200 dark:[&:has([data-new-env-cell]:hover)_[data-new-env-cell]]:bg-zinc-700/60'
              )}
              style={{ minWidth: layout.tableMinWidth, width: layout.tableWidth }}
              onClick={userCanCreateEnvironments ? handleGridClick : undefined}
              onMouseOver={handleGridMouseOver}
              onMouseLeave={() => markHoveredHeader(null)}
            >
              <colgroup>
                <col data-col-id={keyColumn} style={{ width: layout.keyColumnWidth }} />
                {columns.map((column) => {
                  const custom =
                    layout.resizable && column.checked ? columnWidths[column.env.id] : undefined
                  return (
                    <col
                      key={column.env.id}
                      data-col-id={column.env.id}
                      style={
                        !column.checked
                          ? { width: SLIM_COLUMN_WIDTH }
                          : custom !== undefined
                            ? { width: `${clampColumnPx(custom)}px` }
                            : undefined
                      }
                    />
                  )
                })}
                <col style={{ width: `${trailingRem}rem` }} />
              </colgroup>
              <SecretsGridHeader
                columns={columns}
                appId={app}
                canCreateEnvironments={userCanCreateEnvironments}
                canManageEnvironments={userCanUpdateEnvironments}
                allowReordering={allowEnvReordering}
                dirtyEnvIds={dirtyEnvSet}
                onToggle={handleToggleEnv}
                onSolo={handleSoloEnv}
                onMove={handleMoveEnv}
                onDrop={handleDropEnv}
                onExport={handleExportEnv}
                resizable={layout.resizable}
                keyColumnId={keyColumn}
                onResizePreview={handleResizePreview}
                onResize={setColumnWidth}
                newEnvironmentRef={newEnvironmentRef}
              />
              <tbody>
                {hasResults ? (
                  <>
                    {renderSecretRows()}
                  </>
                ) : (
                  <tr>
                    <td colSpan={colSpan} className="p-0">
                      {/* Stays centered in the visible area while the grid scrolls sideways */}
                      <div className="sticky left-0 w-[100cqw] py-10">{renderEmptyState()}</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <GridScrollControls scrollerRef={gridScrollerRef} />
          <DeleteAppFolderDialog
            target={folderDeleteTarget}
            onClose={() => setFolderDeleteTarget(null)}
            onDelete={handleDeleteFolders}
          />
          </div>
        )}
      </section>
    </SecretReferenceContext.Provider>
  )
}
