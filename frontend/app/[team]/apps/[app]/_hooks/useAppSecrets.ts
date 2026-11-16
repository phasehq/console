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

const DECRYPTED_SECRETS = 'decrypted-secrets'

/**
 * Decrypted secrets by the query's own objects: Apollo hands the same object back for a secret that
 * hasn't changed, so only new and changed ones are decrypted again after a poll, a deploy or a remount.
 * Held in the app's secrets cache, which is dropped on leaving the app and when the keyring locks.
 */
const decryptedSecretsIn = (cache: Map<string, unknown>) => {
  let held = cache.get(DECRYPTED_SECRETS) as WeakMap<SecretType, SecretType> | undefined
  if (!held) {
    held = new WeakMap()
    cache.set(DECRYPTED_SECRETS, held)
  }
  return held
}

const foldersOf = (env: EnvironmentType) =>
  (env.folders ?? []).filter((folder): folder is SecretFolderType => Boolean(folder))

const buildFolders = (environments: EnvironmentType[]): AppFolder[] => {
  const slot = (folder: { name: string; path: string }) => `${folder.name}::${folder.path}`
  const folders = new Map<string, { name: string; path: string }>()
  // Each env's folders by slot, looked up once: scanning per folder per env is quadratic in a deep tree
  const byEnv = environments.map((env) => {
    const own = new Map<string, SecretFolderType>()
    for (const folder of foldersOf(env)) {
      if (!own.has(slot(folder))) own.set(slot(folder), folder)
      folders.set(slot(folder), { name: folder.name, path: folder.path })
    }
    return own
  })

  return Array.from(folders.values()).map(({ name, path }) => ({
    name,
    path,
    envs: environments.map((env, at) => ({
      env,
      folder: byEnv[at].get(slot({ name, path })) ?? null,
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
  // The load or a decrypt failed with nothing to show: the page says so instead of waiting forever
  const [failed, setFailed] = useState(false)

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

  const { data, error, refetch } = useQuery(GetAppSecrets, {
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
      const raw = (env.secrets ?? []) as SecretType[]
      const held = decryptedSecretsIn(cache)
      const fresh = raw.filter((secret) => !held.has(secret))
      const decryptedFresh = await decryptEnvSecretKVs(fresh, envKeys)
      fresh.forEach((secret, at) => held.set(secret, decryptedFresh[at]))
      const secrets = raw.map((secret) => held.get(secret)!)
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
      setFailed(false)
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

    // One value that won't decrypt would otherwise leave the first load pending for good
    run().catch(() => {
      if (cancelled) return
      setFailed(true)
      setFetching(false)
    })

    return () => {
      cancelled = true
    }
  }, [data, keyring, appId, cache, cacheKey])

  useEffect(() => {
    if (!error || data) return
    setFailed(true)
    setFetching(false)
  }, [error, data])

  return {
    environments: processed?.environments ?? NO_ENVIRONMENTS,
    appSecrets: processed?.appSecrets ?? NO_SECRETS,
    appFolders: processed?.appFolders ?? NO_FOLDERS,
    appDynamicSecrets: processed?.appDynamicSecrets ?? NO_DYNAMIC_SECRETS,
    pendingEnvIds: processed?.pendingEnvIds ?? NO_PENDING,
    /** True only for the first load (no snapshot to show yet) */
    fetching,
    /** The latest load or decrypt failed; a later one that works clears it */
    failed,
    refetch,
  }
}
