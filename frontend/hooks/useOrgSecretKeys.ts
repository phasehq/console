import { useApolloClient } from '@apollo/client'
import { useContext, useEffect, useRef, useState } from 'react'
import { unwrapEnvSecretsForUser } from '@/utils/crypto'
import { decryptAsymmetric } from '@/utils/crypto/general'
import GetOrgSecretKeys from '@/graphql/queries/secrets/getOrgSecretKeys.gql'
import { KeyringContext } from '@/contexts/keyringContext'
import { organisationContext } from '@/contexts/organisationContext'
import { OrgApp, secretIdKey } from '@/utils/secretReferences'

/**
 * Fetches and decrypts all secret keys across all apps in the org.
 * Returns structured data for cross-app reference autocomplete and validation.
 * Caches the result so decryption only happens once per session.
 */
export function useOrgSecretKeys(): { orgApps: OrgApp[]; loading: boolean } {
  const client = useApolloClient()
  const { keyring } = useContext(KeyringContext)
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const cacheRef = useRef<OrgApp[] | null>(null)
  const [orgApps, setOrgApps] = useState<OrgApp[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!organisation?.id || !keyring) return

    let cancelled = false

    const fetchAndDecrypt = async () => {
      if (cacheRef.current) {
        setOrgApps(cacheRef.current)
        return
      }

      setLoading(true)
      const apps: OrgApp[] = []

      try {
        const { data } = await client.query({
          query: GetOrgSecretKeys,
          variables: { organisationId: organisation.id },
          fetchPolicy: 'cache-first',
        })

        for (const app of data.apps ?? []) {
          const envNames: string[] = []
          const envIds: Record<string, string> = {}
          const envSecretKeys: Record<string, string[]> = {}
          const envRootKeysMap: Record<string, Set<string>> = {}
          const folderKeysMap: Record<string, Set<string>> = {}
          const secretIdLookupMap: Record<string, string> = {}

          for (const env of app.environments ?? []) {
            envNames.push(env.name)
            envIds[env.name.toLowerCase()] = env.id

            try {
              const { publicKey, privateKey } = await unwrapEnvSecretsForUser(
                env.wrappedSeed,
                env.wrappedSalt,
                keyring
              )

              const keys: string[] = []
              for (const secret of env.secrets ?? []) {
                try {
                  const decryptedKey = await decryptAsymmetric(
                    secret.key,
                    privateKey,
                    publicKey
                  )
                  keys.push(decryptedKey)

                  // Map secret to its ID for navigation URLs
                  secretIdLookupMap[secretIdKey(env.name, secret.path || '/', decryptedKey)] = secret.id

                  // Group by folder path for folder-qualified references
                  const secretPath = (secret.path || '/').replace(/^\/+/, '').replace(/\/+$/, '')
                  if (secretPath) {
                    if (!folderKeysMap[secretPath.toLowerCase()]) {
                      folderKeysMap[secretPath.toLowerCase()] = new Set()
                    }
                    folderKeysMap[secretPath.toLowerCase()].add(decryptedKey)
                  } else {
                    // Root-level key
                    const envKey = env.name.toLowerCase()
                    if (!envRootKeysMap[envKey]) {
                      envRootKeysMap[envKey] = new Set()
                    }
                    envRootKeysMap[envKey].add(decryptedKey)
                  }
                } catch {
                  // Skip secrets we can't decrypt (no access)
                }
              }

              envSecretKeys[env.name.toLowerCase()] = keys
            } catch {
              // Skip environments we can't unwrap (no access)
              envSecretKeys[env.name.toLowerCase()] = []
            }
          }

          const folderKeys: Record<string, string[]> = {}
          for (const [path, keySet] of Object.entries(folderKeysMap)) {
            folderKeys[path] = [...keySet]
          }

          const envRootKeys: Record<string, string[]> = {}
          for (const [envKey, keySet] of Object.entries(envRootKeysMap)) {
            envRootKeys[envKey] = [...keySet]
          }

          apps.push({ id: app.id, name: app.name, envNames, envIds, envSecretKeys, envRootKeys, folderKeys, secretIdLookup: secretIdLookupMap })
        }
      } catch (error) {
        console.error('Failed to fetch org secret keys for reference autocomplete', error)
      }

      if (cancelled) return
      cacheRef.current = apps
      setOrgApps(apps)
      setLoading(false)
    }

    fetchAndDecrypt()

    return () => {
      cancelled = true
    }
  }, [organisation?.id, keyring, client])

  return { orgApps, loading }
}
