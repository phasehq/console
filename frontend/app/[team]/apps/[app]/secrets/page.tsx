'use client'

import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetSecretNames } from '@/graphql/queries/secrets/getSecretNames.gql'
import { GetOrganisations } from '@/graphql/queries/getOrganisations.gql'
import { GetOrganisationAdminsAndSelf } from '@/graphql/queries/organisation/getOrganisationAdminsAndSelf.gql'
import { InitAppEnvironments } from '@/graphql/mutations/environments/initAppEnvironments.gql'
import UpdateEnvScope from '@/graphql/mutations/apps/updateEnvScope.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { useCallback, useContext, useEffect, useState } from 'react'
import { createNewEnv, decryptEnvSecretNames, unwrapEnvSecretsForUser } from '@/utils/environments'
import { Button } from '@/components/common/Button'
import {
  ApiEnvironmentEnvTypeChoices,
  ApiOrganisationMemberRoleChoices,
  EnvironmentType,
  OrganisationMemberType,
  SecretType,
} from '@/apollo/graphql'
import _sodium from 'libsodium-wrappers-sumo'
import { KeyringContext } from '@/contexts/keyringContext'
import UnlockKeyringDialog from '@/components/auth/UnlockKeyringDialog'
import { FaCheckCircle, FaTimesCircle } from 'react-icons/fa'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { organisationContext } from '@/contexts/organisationContext'
import { userIsAdmin } from '@/utils/permissions'

type EnvSecrets = {
  env: EnvironmentType
  secrets: SecretType[]
}

export default function Secrets({ params }: { params: { team: string; app: string } }) {
  const { data } = useQuery(GetAppEnvironments, {
    variables: {
      appId: params.app,
    },
  })
  const { data: orgsData } = useQuery(GetOrganisations)

  const [getOrgAdmins, { data: orgAdminsData }] = useLazyQuery(GetOrganisationAdminsAndSelf)

  const [getEnvSecrets] = useLazyQuery(GetSecretNames)
  const [initAppEnvironments] = useMutation(InitAppEnvironments)
  const [updateScope] = useMutation(UpdateEnvScope)

  const [commonSecrets, setCommonSecrets] = useState<SecretType[]>([])
  const [envSecrets, setEnvSecrets] = useState<EnvSecrets[]>([])

  const sortedEnvSecrets = [...envSecrets].sort((a, b) => {
    const order = ['Development', 'Staging', 'Production']
    const indexA = order.indexOf(a.env.name)
    const indexB = order.indexOf(b.env.name)

    return indexA - indexB
  })

  const { keyring } = useContext(KeyringContext)
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const activeUserIsAdmin = organisation ? userIsAdmin(organisation.role!) : false

  useEffect(() => {
    if (orgsData) {
      const organisationId = orgsData.organisations[0].id
      getOrgAdmins({
        variables: {
          organisationId,
        },
      })
    }
  }, [getOrgAdmins, orgsData, params.app])

  const setupRequired = data?.appEnvironments.length === 0 ?? true

  const commonSecretsKeys = Array.from(new Set(commonSecrets.map((secret) => secret.key)))

  const updateCommonSecrets = useCallback((decryptedSecrets: SecretType[]) => {
    setCommonSecrets((prevCommonSecrets) => [...prevCommonSecrets, ...decryptedSecrets])
  }, [])

  const fetchAndDecryptAppEnvs = async (appEnvironments: EnvironmentType[]) => {
    let envCards = [] as EnvSecrets[]

    appEnvironments.forEach(async (env: EnvironmentType) => {
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

      const decryptedSecrets = await decryptEnvSecretNames(data.secrets, {
        publicKey,
        privateKey,
      })

      envCards.push({ env, secrets: decryptedSecrets })
      updateCommonSecrets(decryptedSecrets)
    })

    setEnvSecrets(envCards)
  }

  useEffect(() => {
    if (keyring !== null && data?.appEnvironments) fetchAndDecryptAppEnvs(data?.appEnvironments)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.appEnvironments, keyring])

  const initAppEnvs = async () => {
    const mutationPayload = {
      devEnv: await createNewEnv(
        params.app,
        'Development',
        ApiEnvironmentEnvTypeChoices.Dev,
        orgAdminsData.organisationAdminsAndSelf
      ),
      stagingEnv: await createNewEnv(
        params.app,
        'Staging',
        ApiEnvironmentEnvTypeChoices.Staging,
        orgAdminsData.organisationAdminsAndSelf
      ),
      prodEnv: await createNewEnv(
        params.app,
        'Production',
        ApiEnvironmentEnvTypeChoices.Prod,
        orgAdminsData.organisationAdminsAndSelf
      ),
    }

    await initAppEnvironments({
      variables: {
        devEnv: mutationPayload.devEnv.createEnvPayload,
        stagingEnv: mutationPayload.stagingEnv.createEnvPayload,
        prodEnv: mutationPayload.prodEnv.createEnvPayload,
        devAdminKeys: mutationPayload.devEnv.adminKeysPayload,
        stagAdminKeys: mutationPayload.stagingEnv.adminKeysPayload,
        prodAdminKeys: mutationPayload.prodEnv.adminKeysPayload,
      },
      refetchQueries: [
        {
          query: GetAppEnvironments,
          variables: {
            appId: params.app,
          },
        },
      ],
    })
  }

  const EnvCard = (props: { envSecrets: EnvSecrets }) => {
    const { env, secrets } = props.envSecrets

    const secretExistsInEnv = (key: string) => {
      return secrets.find((s: SecretType) => s.key === key)
    }

    const pathname = usePathname()

    return (
      <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg flex flex-col gap-4 p-4 w-60">
        <div className="text-2xl text-center font-light text-neutral-500">
          <Link href={`${pathname}/environments/${env.id}`}>{env.name}</Link>
        </div>
        <div className="flex flex-col gap-4 p-4">
          {commonSecretsKeys.map((key: string, index: number) => (
            <div key={index} className="flex h-6 items-center justify-center text-neutral-500">
              {secretExistsInEnv(key) ? (
                <div className="break-all flex items-center gap-2 group text-base">
                  <FaCheckCircle className="text-emerald-500 shrink-0" />
                </div>
              ) : (
                <FaTimesCircle className="text-red-500" />
              )}
            </div>
          ))}
        </div>
        <div className="flex w-full justify-center">
          <Link href={`${pathname}/environments/${env.id}`}>
            <Button variant="primary">Manage</Button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-h-screen overflow-y-auto w-full text-black dark:text-white grid grid-cols-1 md:grid-cols-3 gap-16">
      {orgsData?.organisations && (
        <UnlockKeyringDialog organisationId={orgsData.organisations[0].id} />
      )}
      {keyring !== null && (
        <section className="md:col-span-3">
          {setupRequired ? (
            <div className="flex flex-col gap-4 w-full items-center p-16">
              <h2 className="text-white font-semibold text-xl">
                {activeUserIsAdmin
                  ? "There aren't any environments for this app yet"
                  : "You don't have access to any environments for this app yet. Contact the organisation owner or admins to get access."}
              </h2>
              {activeUserIsAdmin && (
                <Button variant="primary" onClick={initAppEnvs}>
                  Get started
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3">
                <div className="mt-8 flex flex-row col-span-2 w-full gap-8">
                  <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg flex flex-col gap-4 p-4">
                    <div className="text-neutral-500 text-2xl px-4">KEY</div>
                    <div className="flex flex-col gap-4 p-4 w-max">
                      {commonSecretsKeys.map((secret: string, index: number) => (
                        <div key={index}>
                          <div className="font-mono">{secret}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-8">
                    {sortedEnvSecrets.map((envS: EnvSecrets) => (
                      <EnvCard key={envS.env.id} envSecrets={envS} />
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}
