'use client'

import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetSecretNames } from '@/graphql/queries/secrets/getSecretNames.gql'
import { GetOrganisations } from '@/graphql/queries/getOrganisations.gql'
import { GetOrganisationAdminsAndSelf } from '@/graphql/queries/organisation/getOrganisationAdminsAndSelf.gql'
import { InitAppEnvironments } from '@/graphql/mutations/environments/initAppEnvironments.gql'
import { CreateNewUserToken } from '@/graphql/mutations/users/createUserToken.gql'
import { CreateNewServiceToken } from '@/graphql/mutations/environments/createServiceToken.gql'
import { GetUserTokens } from '@/graphql/queries/users/getUserTokens.gql'
import { GetServiceTokens } from '@/graphql/queries/secrets/getServiceTokens.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { useCallback, useContext, useEffect, useState } from 'react'
import {
  createNewEnvPayload,
  decryptEnvSecretNames,
  generateUserToken,
  newEnvToken,
  newEnvWrapKey,
  newServiceTokenKeys,
  unwrapEnvSecretsForUser,
  wrapEnvSecretsForServiceToken,
} from '@/utils/environments'
import { Button } from '@/components/common/Button'
import {
  ApiEnvironmentEnvTypeChoices,
  ApiOrganisationMemberRoleChoices,
  EnvironmentKeyInput,
  EnvironmentType,
  OrganisationMemberType,
  SecretType,
  ServiceTokenType,
  UserTokenType,
} from '@/apollo/graphql'
import { getUserKxPrivateKey, getUserKxPublicKey, randomKeyPair } from '@/utils/crypto'
import _sodium from 'libsodium-wrappers-sumo'
import { KeyringContext } from '@/contexts/keyringContext'
import UnlockKeyringDialog from '@/components/auth/UnlockKeyringDialog'
import { FaCheckCircle, FaTimesCircle } from 'react-icons/fa'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { splitSecret } from '@/utils/keyshares'
import { cryptoUtils } from '@/utils/auth'

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
  const [getUserTokens, { data: userTokensData }] = useLazyQuery(GetUserTokens)
  const [getServiceTokens, { data: serviceTokensData }] = useLazyQuery(GetServiceTokens)
  const [getEnvKey] = useLazyQuery(GetEnvironmentKey)
  const [getEnvSecrets] = useLazyQuery(GetSecretNames)
  const [initAppEnvironments] = useMutation(InitAppEnvironments)
  const [createUserToken] = useMutation(CreateNewUserToken)
  const [createServiceToken] = useMutation(CreateNewServiceToken)
  const [commonSecrets, setCommonSecrets] = useState<SecretType[]>([])
  const [envSecrets, setEnvSecrets] = useState<EnvSecrets[]>([])

  const sortedEnvSecrets = [...envSecrets].sort((a, b) => {
    const order = ['Development', 'Staging', 'Production']
    const indexA = order.indexOf(a.env.name)
    const indexB = order.indexOf(b.env.name)

    return indexA - indexB
  })

  const [userToken, setUserToken] = useState<string>('')
  const [serviceToken, setServiceToken] = useState<string>('')

  const { keyring } = useContext(KeyringContext)

  useEffect(() => {
    if (orgsData) {
      const organisationId = orgsData.organisations[0].id
      getOrgAdmins({
        variables: {
          organisationId,
        },
      })
      getUserTokens({
        variables: {
          organisationId,
        },
      })
      getServiceTokens({
        variables: {
          appId: params.app,
        },
      })
    }
  }, [getOrgAdmins, getServiceTokens, getUserTokens, orgsData, params.app])

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
    const owner = orgAdminsData.organisationAdminsAndSelf.find(
      (user: OrganisationMemberType) => user.role === ApiOrganisationMemberRoleChoices.Owner
    )

    const mutationPayload = {
      devEnv: await createNewEnvPayload(
        params.app,
        'Development',
        ApiEnvironmentEnvTypeChoices.Dev,
        owner
      ),
      stagingEnv: await createNewEnvPayload(
        params.app,
        'Staging',
        ApiEnvironmentEnvTypeChoices.Staging,
        owner
      ),
      prodEnv: await createNewEnvPayload(
        params.app,
        'Production',
        ApiEnvironmentEnvTypeChoices.Prod,
        owner
      ),
    }

    await initAppEnvironments({
      variables: {
        devEnv: mutationPayload.devEnv,
        stagingEnv: mutationPayload.stagingEnv,
        prodEnv: mutationPayload.prodEnv,
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

  const handleCreateNewUserToken = async () => {
    if (keyring) {
      const userKxKeys = {
        publicKey: await getUserKxPublicKey(keyring.publicKey),
        privateKey: await getUserKxPrivateKey(keyring.privateKey),
      }

      const { pssUser, mutationPayload } = await generateUserToken(
        orgsData.organisations[0].id,
        userKxKeys
      )

      await createUserToken({
        variables: mutationPayload,
        refetchQueries: [
          {
            query: GetUserTokens,
            variables: {
              organisationId: orgsData.organisations[0].id,
            },
          },
        ],
      })

      setUserToken(pssUser)
    } else {
      console.log('keyring unavailable')
    }
  }

  const handleCreateNewServiceToken = async () => {
    if (keyring) {
      const appEnvironments = data.appEnvironments as EnvironmentType[]

      const token = await newEnvToken()
      const wrapKey = await newEnvWrapKey()

      const tokenKeys = await newServiceTokenKeys()
      const keyShares = await splitSecret(tokenKeys.privateKey)
      const wrappedKeyShare = await cryptoUtils.wrappedKeyShare(keyShares[1], wrapKey)

      const pssService = `pss_service:v1:${token}:${tokenKeys.publicKey}:${keyShares[0]}:${wrapKey}`

      const envKeyPromises = appEnvironments.map(async (env: EnvironmentType) => {
        const { data } = await getEnvKey({
          variables: {
            envId: env.id,
          },
        })

        const {
          wrappedSeed: userWrappedSeed,
          wrappedSalt: userWrappedSalt,
          identityKey,
        } = data.environmentKeys[0]

        const { seed, salt } = await unwrapEnvSecretsForUser(
          userWrappedSeed,
          userWrappedSalt,
          keyring!
        )

        const { wrappedSeed, wrappedSalt } = await wrapEnvSecretsForServiceToken(
          { seed, salt },
          tokenKeys.publicKey
        )

        return {
          envId: env.id,
          identityKey,
          wrappedSeed,
          wrappedSalt,
        }
      })

      const envKeyInputs = await Promise.all(envKeyPromises)

      await createServiceToken({
        variables: {
          appId: params.app,
          environmentKeys: envKeyInputs,
          identityKey: tokenKeys.publicKey,
          token,
          wrappedKeyShare,
          name: 'testServiceToken',
          expiry: null,
        },
        refetchQueries: [
          {
            query: GetServiceTokens,
            variables: {
              appId: params.app,
            },
          },
        ],
      })

      setServiceToken(pssService)
    }
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
                {"You don't have any environments for this app yet"}
              </h2>
              <Button variant="primary" onClick={initAppEnvs}>
                Get started
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3">
                <div className="mt-8 flex flex-row col-span-2 w-full gap-8">
                  <div className="bg-zinc-100 dark:bg-zinc-800 rounded-lg flex flex-col gap-4 p-4">
                    <div className="text-neutral-500 text-2xl px-4">KEY</div>
                    <div className="flex flex-col gap-4 p-4">
                      {commonSecretsKeys.map((secret: string, index: number) => (
                        <div key={index}>
                          <div className="break-all font-mono">{secret}</div>
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
                <div className="space-y-6">
                  <div className="flex flex-col gap-2">
                    <h3 className="text-xl font-semibold  border-b border-neutral-500">
                      User tokens
                    </h3>
                    {userTokensData?.userTokens.map((userToken: UserTokenType) => (
                      <div key={userToken.id}>
                        {userToken.name} | {userToken.createdAt}
                      </div>
                    ))}
                    <code className="break-all p-2">{userToken}</code>
                    <div>
                      <Button variant="outline" onClick={handleCreateNewUserToken}>
                        Create new user token
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <h3 className="text-xl font-semibold  border-b border-neutral-500">
                      Service tokens
                    </h3>
                    {serviceTokensData?.serviceTokens.map((serviceToken: ServiceTokenType) => (
                      <div key={serviceToken.id}>
                        {serviceToken.name} | {serviceToken.createdAt}
                      </div>
                    ))}
                    <code className="break-all p-2">{serviceToken}</code>
                    <div>
                      <Button variant="outline" onClick={handleCreateNewServiceToken}>
                        Create new service token
                      </Button>
                    </div>
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
