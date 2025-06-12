import { useApolloClient } from '@apollo/client'
import { useEffect, useRef, useState } from 'react'
import { unwrapEnvSecretsForUser } from '@/utils/crypto'
import { decryptAsymmetric } from '@/utils/crypto/general'
import GetOrgSecretKeys from '@/graphql/queries/secrets/getOrgSecretKeys.gql'
import { OrganisationKeyring } from '@/utils/crypto'

interface SecretMeta {
  id: string
  key: string
  appId: string
  envId: string
  path: string
  appName: string
  envName: string
}

interface UseSecretSearchReturn {
  results: SecretMeta[]
  loading: boolean
}

// Fetches and decrypts secret keys once per-organisaton on first query, then caches.
export const useSecretSearch = (
  query: string,
  organisationId: string | undefined | null,
  keyring: OrganisationKeyring | null
): UseSecretSearchReturn => {
  const client = useApolloClient()
  const cacheRef = useRef<SecretMeta[] | null>(null)
  const [results, setResults] = useState<SecretMeta[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    const executeSearch = async () => {
      // Simple normalisation: remove spaces/underscores, lowercase.
      const normalize = (str: string) => str.replace(/[\\s_]/g, '').toLowerCase()
      const normalizedQuery = normalize(query)

      if (!normalizedQuery) {
        setResults([])
        return
      }
      if (!organisationId || !keyring) return

      if (!cacheRef.current) {
        setLoading(true)
        const collected: SecretMeta[] = []

        try {
          const { data } = await client.query({
            query: GetOrgSecretKeys,
            variables: { organisationId },
            fetchPolicy: 'network-only',
          })

          for (const app of data.apps) {
            for (const env of app.environments) {
              const { publicKey, privateKey } = await unwrapEnvSecretsForUser(
                env.wrappedSeed,
                env.wrappedSalt,
                keyring
              )

              for (const secret of env.allSecrets) {
                const decryptedKey = await decryptAsymmetric(
                  secret.key,
                  privateKey,
                  publicKey
                )
                collected.push({
                  id: secret.id,
                  key: decryptedKey,
                  appId: app.id,
                  envId: env.id,
                  path: secret.path,
                  appName: app.name,
                  envName: env.name,
                })
              }
            }
          }
        } catch (error) {
          console.error('Secret key fetch failed', error)
        }

        if (cancelled) return
        cacheRef.current = collected
        setLoading(false)
      }

      const filtered = cacheRef.current!.filter((s) =>
        normalize(s.key).includes(normalizedQuery)
      )
      setResults(filtered)
    }

    executeSearch()

    return () => {
      cancelled = true
    }
  }, [query, organisationId, keyring, client])

  return { results, loading }
}
