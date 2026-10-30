import { useEffect, useState, useContext, useRef } from 'react'
import { useQuery } from '@apollo/client'
import { unwrapEnvSecretsForUser, decryptEnvSecretKVs } from '@/utils/crypto'
import { AppSecret, AppFolder } from '../types'
import { GetAppSecrets } from '@/graphql/queries/secrets/getAppSecrets.gql'
import { KeyringContext } from '@/contexts/keyringContext'
import { EnvironmentType, DynamicSecretType, SecretFolderType, SecretType } from '@/apollo/graphql'
import { decryptDynamicSecretKeyNames } from '@/ee/utils/dynamicSecrets'
import { buildAppSecretRows } from '@/utils/appSecrets'
import { filterEnvSelection } from '../_components/EnvSelectionProvider'
import { useSecretsCache } from '../_components/SecretsCacheProvider'

export type AppDynamicSecret = {
  id: string
  name: string
  path: string
  envs: {
    env: EnvironmentType
    dynamicSecret: DynamicSecretType | null
  }[]
}

export type ProcessedAppSecrets = {
  /** Every environment of the app, in server order */
  environments: EnvironmentType[]
  /** One row per key, with an entry for every environment */
  appSecrets: AppSecret[]
  appFolders: AppFolder[]
  appDynamicSecrets: AppDynamicSecret[]
  /** Envs still decrypting in the background (hidden columns) */
  pendingEnvIds: string[]
}

/** Key of the app's decrypted snapshot (every folder) in the layout-scoped secrets cache */
export const appSecretsCacheKey = (appId: string) => `app-secrets|${appId}`

type DecryptedEnv = {
  /** The query result object this was decrypted from — a new object means new data */
  source: EnvironmentType
  secrets: SecretType[]
  dynamicSecrets: DynamicSecretType[]
}

// Stable empties: consumers sync state from these, so a fresh [] per render would loop
const NO_ENVIRONMENTS: EnvironmentType[] = []
const NO_SECRETS: AppSecret[] = []
const NO_FOLDERS: AppFolder[] = []
const NO_DYNAMIC_SECRETS: AppDynamicSecret[] = []
const NO_PENDING: string[] = []

const foldersOf = (env: EnvironmentType) =>
  (env.folders ?? []).filter((folder): folder is SecretFolderType => Boolean(folder))

const buildFolders = (environments: EnvironmentType[]): AppFolder[] => {
  const folders = new Map<string, { name: string; path: string }>()
  for (const env of environments) {
    for (const folder of foldersOf(env)) {
      folders.set(`${folder.name}::${folder.path}`, { name: folder.name, path: folder.path })
    }
  }

  return Array.from(folders.values()).map(({ name, path }) => ({
    name,
    path,
    envs: environments.map((env) => ({
      env,
      folder: foldersOf(env).find((f) => f.name === name && f.path === path) ?? null,
    })),
  }))
}

const buildDynamicSecrets = (
  appId: string,
  environments: EnvironmentType[],
  decrypted: Map<string, DecryptedEnv>
): AppDynamicSecret[] => {
  const keys = new Set<string>()
  for (const env of environments) {
    for (const ds of decrypted.get(env.id)?.dynamicSecrets ?? []) keys.add(`${ds.name}::${ds.path}`)
  }

  return Array.from(keys).map((namePathKey) => {
    const [name, path] = namePathKey.split('::')
    return {
      id: `${appId}-${namePathKey}`,
      name,
      path,
      envs: environments.map((env) => ({
        env,
        dynamicSecret:
          decrypted
            .get(env.id)
            ?.dynamicSecrets.find((ds) => ds.name === name && ds.path === path) ?? null,
      })),
    }
  })
}

/**
 * Fetches and decrypts every environment of an app, across every folder (the
 * grid renders them as a tree). Envs in `priorityEnvIds` (the checked columns)
 * are decrypted and published first; the rest follow in the background so
 * checking them later is instant.
 */
export const useAppSecrets = (
  appId: string,
  allowFetch: boolean,
  pollInterval: number = 10000,
  priorityEnvIds: string[] | null = null
) => {
  // Shared across the app's secrets views so revisiting the app (or another
  // folder of it) renders instantly. State is initialized from it lazily so a
  // remount never paints a skeleton frame first.
  const cache = useSecretsCache()
  const cacheKey = appSecretsCacheKey(appId)

  const [processed, setProcessed] = useState<ProcessedAppSecrets | null>(
    () => (cache.get(cacheKey) as ProcessedAppSecrets | undefined) ?? null
  )
  const [fetching, setFetching] = useState(() => !cache.get(cacheKey))

  const { keyring } = useContext(KeyringContext)

  // Per-env results reused across poll ticks while that env's data is unchanged
  const decryptedRef = useRef(new Map<string, DecryptedEnv>())

  // Only orders the work, so selection changes must not re-run the decrypt effect
  const priorityRef = useRef(priorityEnvIds)
  useEffect(() => {
    priorityRef.current = priorityEnvIds
  }, [priorityEnvIds])

  useEffect(() => {
    const cached = cache.get(cacheKey) as ProcessedAppSecrets | undefined
    if (cached) {
      setProcessed(cached)
      setFetching(false)
    } else {
      setFetching(true)
    }
  }, [cache, cacheKey])

  const { data, refetch } = useQuery(GetAppSecrets, {
    // No path: the resolvers then return every folder's secrets and folders
    variables: { appId, path: null },
    fetchPolicy: 'cache-and-network',
    skip: !allowFetch,
    pollInterval,
  })

  useEffect(() => {
    if (!keyring || !data?.appEnvironments) return
    const environments = data.appEnvironments as EnvironmentType[]
    // Guards against a slow decrypt landing after the target has changed
    let cancelled = false

    const decryptEnv = async (env: EnvironmentType): Promise<DecryptedEnv> => {
      const previous = decryptedRef.current.get(env.id)
      if (previous && previous.source === env) return previous

      const envKeys = await unwrapEnvSecretsForUser(env.wrappedSeed!, env.wrappedSalt!, keyring)
      const secrets = await decryptEnvSecretKVs((env.secrets ?? []) as SecretType[], envKeys)
      const dynamicSecrets = await decryptDynamicSecretKeyNames(
        (env.dynamicSecrets ?? []) as DynamicSecretType[],
        envKeys
      )

      const result: DecryptedEnv = {
        source: env,
        // History, overrides and sharing need the secret's env (and its app)
        secrets: secrets.map((secret) => ({ ...secret, environment: env })),
        dynamicSecrets,
      }
      decryptedRef.current.set(env.id, result)
      return result
    }

    const build = (decrypted: Map<string, DecryptedEnv>): ProcessedAppSecrets => ({
      environments,
      appSecrets: buildAppSecretRows(
        appId,
        environments.map((env) => ({ env, secrets: decrypted.get(env.id)?.secrets ?? [] }))
      ),
      appFolders: buildFolders(environments),
      appDynamicSecrets: buildDynamicSecrets(appId, environments, decrypted),
      pendingEnvIds: environments.filter((env) => !decrypted.has(env.id)).map((env) => env.id),
    })

    const publish = (result: ProcessedAppSecrets) => {
      setProcessed(result)
      setFetching(false)
    }

    const run = async () => {
      const shownIds = new Set(
        filterEnvSelection(environments, priorityRef.current).map((env) => env.id)
      )
      const ordered = [
        ...environments.filter((env) => shownIds.has(env.id)),
        ...environments.filter((env) => !shownIds.has(env.id)),
      ]

      const decrypted = new Map<string, DecryptedEnv>()
      let publishedShown = false
      for (const env of ordered) {
        const needsWork = decryptedRef.current.get(env.id)?.source !== env
        // Render the checked columns before starting on the hidden ones
        if (needsWork && !shownIds.has(env.id) && !publishedShown) {
          publish(build(decrypted))
          publishedShown = true
        }
        decrypted.set(env.id, await decryptEnv(env))
        if (cancelled) return
      }

      const complete = build(decrypted)
      cache.set(cacheKey, complete)
      publish(complete)
    }

    run()

    return () => {
      cancelled = true
    }
  }, [data, keyring, appId, cache, cacheKey])

  return {
    environments: processed?.environments ?? NO_ENVIRONMENTS,
    appSecrets: processed?.appSecrets ?? NO_SECRETS,
    appFolders: processed?.appFolders ?? NO_FOLDERS,
    appDynamicSecrets: processed?.appDynamicSecrets ?? NO_DYNAMIC_SECRETS,
    pendingEnvIds: processed?.pendingEnvIds ?? NO_PENDING,
    /** True only for the first load (no snapshot to show yet) */
    fetching,
    refetch,
  }
}
