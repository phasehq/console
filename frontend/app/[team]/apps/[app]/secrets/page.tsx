'use client'

import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvSecretsKV } from '@/graphql/queries/secrets/getSecretKVs.gql'
import { useLazyQuery, useQuery } from '@apollo/client'
import { useContext, useEffect, useState } from 'react'
import { decryptEnvSecretKVs, unwrapEnvSecretsForUser } from '@/utils/environments'
import { EnvironmentType, SecretType } from '@/apollo/graphql'
import _sodium from 'libsodium-wrappers-sumo'
import { KeyringContext } from '@/contexts/keyringContext'
import UnlockKeyringDialog from '@/components/auth/UnlockKeyringDialog'
import { FaArrowRight, FaCheck, FaCheckCircle, FaCircle, FaTimesCircle } from 'react-icons/fa'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { organisationContext } from '@/contexts/organisationContext'
import { Button } from '@/components/common/Button'
import clsx from 'clsx'

type EnvSecrets = {
  env: EnvironmentType
  secrets: SecretType[]
}

type AppSecret = {
  key: string
  envs: Array<{
    env: Partial<EnvironmentType>
    secret: SecretType | null
  }>
}

export default function Secrets({ params }: { params: { team: string; app: string } }) {
  const { data } = useQuery(GetAppEnvironments, {
    variables: {
      appId: params.app,
    },
  })

  const pathname = usePathname()

  const [getEnvSecrets] = useLazyQuery(GetEnvSecretsKV)

  const [appSecrets, setAppSecrets] = useState<AppSecret[]>([])

  const { keyring } = useContext(KeyringContext)
  const { activeOrganisation: organisation } = useContext(organisationContext)

  useEffect(() => {
    const fetchAndDecryptAppEnvs = async (appEnvironments: EnvironmentType[]) => {
      const envSecrets = [] as EnvSecrets[]

      for (const env of appEnvironments) {
        const { data } = await getEnvSecrets({
          variables: {
            envId: env.id,
          },
        })

        const { wrappedSeed, wrappedSalt } = data.environmentKeys[0]

        const { publicKey, privateKey } = await unwrapEnvSecretsForUser(
          wrappedSeed,
          wrappedSalt,
          keyring!
        )

        const decryptedSecrets = await decryptEnvSecretKVs(data.secrets, {
          publicKey,
          privateKey,
        })

        envSecrets.push({ env, secrets: decryptedSecrets })
      }

      // Create a list of unique secret keys
      const secretKeys = Array.from(
        new Set(envSecrets.flatMap((envCard) => envCard.secrets.map((secret) => secret.key)))
      )

      // Transform envCards into an array of AppSecret objects
      const appSecrets = secretKeys.map((key) => {
        const envs = envSecrets.map((envCard) => ({
          env: envCard.env,
          secret: envCard.secrets.find((secret) => secret.key === key) || null,
        }))
        return { key, envs }
      })

      setAppSecrets(appSecrets)
    }

    if (keyring !== null && data?.appEnvironments) fetchAndDecryptAppEnvs(data?.appEnvironments)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.appEnvironments, keyring])

  const AppSecretRow = (props: { appSecret: AppSecret }) => {
    const { appSecret } = props

    const prodSecret = appSecret.envs.find(
      (env) => env.env.envType?.toLowerCase() === 'prod'
    )?.secret

    const secretIsSameAsProd = (env: {
      env: Partial<EnvironmentType>
      secret: SecretType | null
    }) =>
      prodSecret !== null &&
      env.secret?.value === prodSecret?.value &&
      env.env.envType?.toLowerCase() !== 'prod'

    const tooltipText = (env: { env: Partial<EnvironmentType>; secret: SecretType | null }) => {
      if (env.secret === null) return `This secret is missing in ${env.env.envType}`
      else if (env.secret.value.length === 0) return `This secret is blank in ${env.env.envType}`
      else if (secretIsSameAsProd(env)) return `This secret is the same as PROD.`
      else return 'This secret is present'
    }

    return (
      <tr className="divide-x divide-neutral-500/40 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition ease duration-100">
        <td className="px-6 py-3 whitespace-nowrap font-mono text-zinc-800 dark:text-zinc-300 font-medium">
          {appSecret.key}
        </td>
        {appSecret.envs.map((env) => (
          <td key={env.env.id} className="px-6 py-3 whitespace-nowrap ">
            <div className="flex items-center justify-center" title={tooltipText(env)}>
              {env.secret !== null ? (
                env.secret.value.length === 0 ? (
                  <FaCircle className="text-neutral-500 shrink-0" />
                ) : (
                  <FaCheckCircle
                    className={clsx(
                      'shrink-0',
                      secretIsSameAsProd(env) ? 'text-amber-500' : 'text-emerald-500'
                    )}
                  />
                )
              ) : (
                <FaTimesCircle className="text-red-500 shrink-0" />
              )}
            </div>
          </td>
        ))}
      </tr>
    )
  }

  return (
    <div className="max-h-screen overflow-y-auto w-full text-black dark:text-white grid gap-16 relative">
      {organisation && <UnlockKeyringDialog organisationId={organisation.id} />}
      {keyring !== null && (
        <section className="space-y-6 divide-y divide-neutral-500/40">
          <table className="table-auto min-w-full divide-y divide-neutral-500/40">
            <thead id="table-head" className="sticky top-0 bg-zinc-200 dark:bg-zinc-800">
              <tr className="divide-x divide-neutral-500/40">
                <th className="px-6 py-2 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                  key
                </th>
                {data?.appEnvironments.map((env: EnvironmentType) => (
                  <th
                    key={env.id}
                    className="group text-center text-sm font-semibold uppercase tracking-widest"
                  >
                    <Link href={`${pathname}/environments/${env.id}`}>
                      <div className="flex items-center justify-center gap-2 px-6 py-3 text-black dark:text-white group-hover:text-emerald-500">
                        {env.envType}
                        <div className="opacity-0 group-hover:opacity-100 transform -translate-x-8 group-hover:translate-x-0 transition ease">
                          <FaArrowRight />
                        </div>
                      </div>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-500/40">
              {appSecrets.map((appSecret, index) => (
                <AppSecretRow key={`${appSecret.key}${index}`} appSecret={appSecret} />
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-end gap-8 p-4 text-neutral-500">
            <div className="flex items-center gap-2">
              <FaCheckCircle className="text-emerald-500 shrink-0" /> Secret is present
            </div>
            <div className="flex items-center gap-2">
              <FaCheckCircle className="text-amber-500 shrink-0" /> Secret is the same as Production
            </div>
            <div className="flex items-center gap-2">
              <FaCircle className="text-neutral-500 shrink-0" /> Secret is blank
            </div>
            <div className="flex items-center gap-2">
              <FaTimesCircle className="text-red-500 shrink-0" /> Secret is missing
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
