import { useEffect, useState, useCallback, useContext } from 'react'
import { useQuery } from '@apollo/client'
import { unwrapEnvSecretsForUser, decryptEnvSecretKVs } from '@/utils/crypto'
import { AppSecret, AppFolder, EnvSecrets, EnvFolders } from '../types'
import { GetAppSecrets } from '@/graphql/queries/secrets/getAppSecrets.gql'
import { KeyringContext } from '@/contexts/keyringContext'
import { EnvironmentType, DynamicSecretType } from '@/apollo/graphql'
import { decryptDynamicSecretKeyNames } from '@/ee/utils/dynamicSecrets'
import { filterEnvSelection } from '../_components/EnvSelectionProvider'
import { useSecretsCache } from '../_components/SecretsCacheProvider'

// Types for dynamic secrets
type EnvDynamicSecrets = {
  env: EnvironmentType
  dynamicSecrets: DynamicSecretType[]
}

type AppDynamicSecret = {
  id: string
  name: string
  path: string
  envs: {
    env: EnvironmentType
    dynamicSecret: DynamicSecretType | null
  }[]
}

type ProcessedAppSecrets = {
  appSecrets: AppSecret[]
  appFolders: AppFolder[]
  appDynamicSecrets: AppDynamicSecret[]
  visibleEnvironments: EnvironmentType[]
}

export const useAppSecrets = (
  appId: string,
  allowFetch: boolean,
  pollInterval: number = 10000,
  path: string = '/',
  envFilter: string[] | null = null
) => {
  // Cache of previously decrypted results, shared across the app's secrets
  // views so revisiting a path (or switching back from an env tab) renders
  // instantly while fresh data loads in the background. State is initialized
  // from it lazily so a remount never paints a skeleton frame first.
  const cache = useSecretsCache()
  const cacheKey = `app-secrets|${appId}|${path}|${envFilter ? envFilter.join(',') : 'all'}`
  const initialCached = cache.get(cacheKey) as ProcessedAppSecrets | undefined

  const [appSecrets, setAppSecrets] = useState<AppSecret[]>(initialCached?.appSecrets ?? [])
  const [appFolders, setAppFolders] = useState<AppFolder[]>(initialCached?.appFolders ?? [])
  const [appDynamicSecrets, setAppDynamicSecrets] = useState<AppDynamicSecret[]>(
    initialCached?.appDynamicSecrets ?? []
  )
  // The env-filtered list the current appSecrets were built from — published
  // together with them so table headers and rows never disagree on columns
  const [visibleEnvironments, setVisibleEnvironments] = useState<EnvironmentType[]>(
    initialCached?.visibleEnvironments ?? []
  )
  const [fetching, setFetching] = useState(!initialCached)

  const { keyring } = useContext(KeyringContext)

  // Hydrate from cache when the target (app/path/env selection) changes;
  // fall back to the loading state on a cache miss.
  useEffect(() => {
    const cached = cache.get(cacheKey) as ProcessedAppSecrets | undefined
    if (cached) {
      setAppSecrets(cached.appSecrets)
      setAppFolders(cached.appFolders)
      setAppDynamicSecrets(cached.appDynamicSecrets)
      setVisibleEnvironments(cached.visibleEnvironments)
      setFetching(false)
    } else {
      setFetching(true)
    }
  }, [cache, cacheKey])

  // Fetch environments and secrets in a single query with polling
  const { data: appSecretsData, refetch } = useQuery(GetAppSecrets, {
    variables: { appId, path },
    fetchPolicy: 'cache-and-network',
    skip: !allowFetch,
    pollInterval, // Polling for environments and secrets
  })

  // Pure compute: decrypts each env's secrets and combines them across envs
  const processAppSecrets = useCallback(
    async (
      appEnvironments: EnvironmentType[],
      secretsData: any
    ): Promise<Omit<ProcessedAppSecrets, 'visibleEnvironments'>> => {
      const envSecrets: EnvSecrets[] = []
      const envFolders: EnvFolders[] = []
      const envDynamicSecrets: EnvDynamicSecrets[] = []

      for (const env of appEnvironments) {
        const secrets = secretsData[env.id]?.secrets || []
        const folders = secretsData[env.id]?.folders || []
        const dynamicSecrets = secretsData[env.id]?.dynamicSecrets || []

        const { wrappedSeed, wrappedSalt } = env

        // Decrypt secrets for the environment
        const { publicKey, privateKey } = await unwrapEnvSecretsForUser(
          wrappedSeed!,
          wrappedSalt!,
          keyring!
        )
        const decryptedSecrets = await decryptEnvSecretKVs(secrets, { publicKey, privateKey })
        const decryptedDynamicSecrets = await decryptDynamicSecretKeyNames(dynamicSecrets, {
          publicKey,
          privateKey,
        })

        envSecrets.push({ env, secrets: decryptedSecrets })
        envFolders.push({ env, folders })
        envDynamicSecrets.push({ env, dynamicSecrets: decryptedDynamicSecrets })
      }

      // Combine secrets across environments, deduped by key (first match per env kept)
      const envSecretsByKey = envSecrets.map((env) => {
        const byKey = new Map<string, (typeof env.secrets)[number]>()
        for (const secret of env.secrets) if (!byKey.has(secret.key)) byKey.set(secret.key, secret)
        return { env: env.env, byKey }
      })
      const appSecrets = Array.from(
        new Set(envSecrets.flatMap((env) => env.secrets.map((secret) => secret.key)))
      ).map((key) => {
        const envs = envSecretsByKey.map(({ env, byKey }) => ({
          env,
          secret: byKey.get(key) || null,
        }))

        return { id: `${appId}-${key}`, key, envs }
      })

      const appFolders = Array.from(
        new Map(
          envFolders.flatMap((env) =>
            env.folders.map((folder) => [
              `${folder.name}::${folder.path}`,
              { name: folder.name, path: folder.path },
            ])
          )
        ).values()
      ).map(({ name, path }) => ({
        name,
        path,
        envs: envFolders.map((env) => ({
          env: env.env,
          folder:
            env.folders.find((folder) => folder.name === name && folder.path === path) || null,
        })),
      }))

      // Combine dynamic secrets across environments and remove duplicates based on name + path
      const appDynamicSecrets = Array.from(
        new Set(
          envDynamicSecrets.flatMap((env) =>
            env.dynamicSecrets.map((ds) => `${ds.name}::${ds.path}`)
          )
        )
      ).map((namePathKey) => {
        const [name, path] = namePathKey.split('::')
        const envs = envDynamicSecrets.map((env) => ({
          env: env.env,
          dynamicSecret:
            env.dynamicSecrets.find((ds) => ds.name === name && ds.path === path) || null,
        }))

        return { id: `${appId}-${namePathKey}`, name, path, envs }
      })

      return { appSecrets, appFolders, appDynamicSecrets }
    },
    [keyring, appId]
  )

  // Watch for changes in the data and process the secrets
  useEffect(() => {
    if (keyring && appSecretsData?.appEnvironments) {
      // Only the selected envs are processed (and decrypted)
      const appEnvironments: EnvironmentType[] = filterEnvSelection(
        appSecretsData.appEnvironments as EnvironmentType[],
        envFilter
      )

      // Process the secrets and environments once the data is available
      const secretsData = appEnvironments.reduce((acc: any, env: EnvironmentType) => {
        acc[env.id] = {
          secrets: env.secrets,
          folders: env.folders,
          dynamicSecrets: env.dynamicSecrets,
        }
        return acc
      }, {})

      // Guard against a slow decrypt landing after the target has changed
      let cancelled = false

      processAppSecrets(appEnvironments, secretsData).then((result) => {
        if (cancelled) return
        const processed: ProcessedAppSecrets = {
          ...result,
          visibleEnvironments: appEnvironments,
        }
        cache.set(cacheKey, processed)
        setAppSecrets(processed.appSecrets)
        setAppFolders(processed.appFolders)
        setAppDynamicSecrets(processed.appDynamicSecrets)
        setVisibleEnvironments(processed.visibleEnvironments)
        setFetching(false)
      })

      return () => {
        cancelled = true
      }
    }
  }, [appSecretsData, keyring, processAppSecrets, envFilter, cache, cacheKey])

  return {
    appEnvironments: appSecretsData?.appEnvironments as EnvironmentType[],
    visibleEnvironments,
    appSecrets,
    appFolders,
    appDynamicSecrets,
    fetching,
    refetch,
  }
}
