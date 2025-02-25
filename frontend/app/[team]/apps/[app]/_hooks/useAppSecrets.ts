import { useEffect, useState, useCallback, useContext } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { unwrapEnvSecretsForUser, decryptEnvSecretKVs } from '@/utils/crypto'
import { AppSecret, AppFolder, EnvSecrets, EnvFolders } from '../types'
import { GetAppSecrets } from '@/graphql/queries/secrets/getAppSecrets.gql'
import { SwapEnvOrder } from '@/graphql/mutations/environments/swapEnvironmentOrder.gql'
import { KeyringContext } from '@/contexts/keyringContext'
import { EnvironmentType } from '@/apollo/graphql'

export const useAppSecrets = (appId: string, allowFetch: boolean, pollInterval: number = 10000) => {
  const [appSecrets, setAppSecrets] = useState<AppSecret[]>([])
  const [appFolders, setAppFolders] = useState<AppFolder[]>([])
  const [fetching, setFetching] = useState(true)
  const [localEnvironments, setLocalEnvironments] = useState<EnvironmentType[]>([])

  const { keyring } = useContext(KeyringContext)

  // Fetch environments and secrets in a single query with polling
  const { data: appSecretsData, refetch } = useQuery(GetAppSecrets, {
    variables: { appId },
    fetchPolicy: 'cache-and-network',
    skip: !allowFetch,
    pollInterval, // Polling for environments and secrets
  })

  const [swapEnvs, { loading }] = useMutation(SwapEnvOrder)

  // Callback for processing secrets data
  const processAppSecrets = useCallback(
    async (appEnvironments: EnvironmentType[], secretsData: any) => {
      const envSecrets: EnvSecrets[] = []
      const envFolders: EnvFolders[] = []

      for (const env of appEnvironments) {
        const secrets = secretsData[env.id]?.secrets || []
        const folders = secretsData[env.id]?.folders || []

        const { wrappedSeed, wrappedSalt } = env

        // Decrypt secrets for the environment
        const { publicKey, privateKey } = await unwrapEnvSecretsForUser(
          wrappedSeed,
          wrappedSalt,
          keyring!
        )
        const decryptedSecrets = await decryptEnvSecretKVs(secrets, { publicKey, privateKey })

        envSecrets.push({ env, secrets: decryptedSecrets })
        envFolders.push({ env, folders })
      }

      // Combine secrets across environments and remove duplicates based on keys
      const appSecrets = Array.from(
        new Set(envSecrets.flatMap((env) => env.secrets.map((secret) => secret.key)))
      ).map((key) => {
        const envs = envSecrets.map((env) => ({
          env: env.env,
          secret: env.secrets.find((secret) => secret.key === key) || null,
        }))

        return { id: `${appId}-${key}`, key, envs }
      })

      const appFolders = Array.from(
        new Set(envFolders.flatMap((env) => env.folders.map((folder) => folder.name)))
      ).map((name) => ({
        name,
        envs: envFolders.map((env) => ({
          env: env.env,
          folder: env.folders.find((folder) => folder.name === name) || null,
        })),
      }))

      setAppSecrets(appSecrets)
      setAppFolders(appFolders)
      setFetching(false)
    },
    [keyring, appId]
  )

  // Watch for changes in the data and process the secrets
  useEffect(() => {
    if (keyring && appSecretsData?.appEnvironments) {
      const appEnvironments = appSecretsData.appEnvironments

      // Process the secrets and environments once the data is available
      const secretsData = appEnvironments.reduce((acc: any, env: EnvironmentType) => {
        acc[env.id] = {
          secrets: env.secrets,
          folders: env.folders,
        }
        return acc
      }, {})

      // Process secrets and folders after the data is loaded
      processAppSecrets(appEnvironments, secretsData)

      // Update local environments only if they're empty (to persist order)
      setLocalEnvironments((prev) => (prev.length === 0 ? appEnvironments : prev))
    }
  }, [appSecretsData, keyring, processAppSecrets])

  // Utility function to swap environment positions
  const swapEnvironments = (environment1Id: string, environment2Id: string) => {
    setLocalEnvironments((prev) => {
      const newEnvs = [...prev]
      const idx1 = newEnvs.findIndex((e) => e.id === environment1Id)
      const idx2 = newEnvs.findIndex((e) => e.id === environment2Id)

      if (idx1 !== -1 && idx2 !== -1) {
        // Swap the positions in the array
        ;[newEnvs[idx1], newEnvs[idx2]] = [newEnvs[idx2], newEnvs[idx1]]

        // Swap their index values
        const tempIndex = newEnvs[idx1].index
        newEnvs[idx1] = { ...newEnvs[idx1], index: newEnvs[idx2].index }
        newEnvs[idx2] = { ...newEnvs[idx2], index: tempIndex }
      }

      return newEnvs.sort((a, b) => a.index! - b.index!)
    })

    //Trigger mutation
    setTimeout(async () => {
      await swapEnvs({
        variables: { environment1Id, environment2Id },
        refetchQueries: [{ query: GetAppSecrets, variables: { appId } }],
      })
    }, 300)
  }

  return {
    appEnvironments: localEnvironments,
    appSecrets,
    appFolders,
    fetching,
    refetch,
    swapEnvironments,
  }
}
