'use client'

import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetSecrets } from '@/graphql/queries/secrets/getSecrets.gql'
import { GetOrganisations } from '@/graphql/queries/getOrganisations.gql'
import { GetOrganisationAdminsAndSelf } from '@/graphql/queries/organisation/getOrganisationAdminsAndSelf.gql'
import { CreateEnv } from '@/graphql/mutations/environments/createEnvironment.gql'
import { InitAppEnvironments } from '@/graphql/mutations/environments/initAppEnvironments.gql'
import { CreateEnvKey } from '@/graphql/mutations/environments/createEnvironmentKey.gql'
import { CreateEnvToken } from '@/graphql/mutations/environments/createEnvironmentToken.gql'
import { CreateNewUserToken } from '@/graphql/mutations/users/createUserToken.gql'
import { GetUserTokens } from '@/graphql/queries/users/getUserTokens.gql'
import { GetEnvironmentTokens } from '@/graphql/queries/secrets/getEnvironmentTokens.gql'
import { CreateSecret } from '@/graphql/mutations/environments/createSecret.gql'
import { gql, useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { useEffect, useState } from 'react'
import { copyToClipBoard } from '@/utils/clipboard'
import { toast } from 'react-toastify'
import { useSession } from 'next-auth/react'
import {
  EnvKeyring,
  envKeyring,
  generateEnvironmentToken,
  generateUserToken,
  newEnvSalt,
  newEnvSeed,
} from '@/utils/environments'
import { Button } from '@/components/common/Button'
import {
  ApiEnvironmentEnvTypeChoices,
  ApiOrganisationMemberRoleChoices,
  EnvironmentKeyType,
  EnvironmentTokenType,
  EnvironmentType,
  MutationCreateEnvironmentArgs,
  OrganisationMemberType,
  SecretType,
  UserTokenType,
} from '@/apollo/graphql'
import {
  createSealedBox,
  decryptAsymmetric,
  digest,
  encryptAsymmetric,
  getUserKxPrivateKey,
  getUserKxPublicKey,
  openSealedBox,
} from '@/utils/crypto'
import { cryptoUtils } from '@/utils/auth'
import { getLocalKeyring } from '@/utils/localStorage'
import _sodium, { KeyPair } from 'libsodium-wrappers-sumo'

export default function Secrets({ params }: { params: { team: string; app: string } }) {
  const { data } = useQuery(GetAppEnvironments, {
    variables: {
      appId: params.app,
    },
  })
  const { data: orgsData } = useQuery(GetOrganisations)

  const [getOrgAdmins, { data: orgAdminsData }] = useLazyQuery(GetOrganisationAdminsAndSelf)
  const [getUserTokens, { data: userTokensData }] = useLazyQuery(GetUserTokens)
  const [createEnvironment, { loading, error }] = useMutation(CreateEnv)
  const [initAppEnvironments] = useMutation(InitAppEnvironments)
  const [createUserToken] = useMutation(CreateNewUserToken)

  const [userToken, setUserToken] = useState<string>('')

  const { data: session } = useSession()

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
    }
  }, [getOrgAdmins, getUserTokens, orgsData, params.app])

  const setupRequired = data?.appEnvironments.length === 0 ?? true

  const wrapEnvSecretsForUser = async (
    envSecrets: { seed: string; salt: string },
    user: OrganisationMemberType
  ) => {
    const userPubKey = await getUserKxPublicKey(user.identityKey!)
    const wrappedSeed = await encryptAsymmetric(envSecrets.seed, userPubKey)
    const wrappedSalt = await encryptAsymmetric(envSecrets.salt, userPubKey)

    return {
      user,
      wrappedSeed,
      wrappedSalt,
    }
  }

  const initAppEnvs = async () => {
    const owner = orgAdminsData.organisationAdminsAndSelf.find(
      (user: OrganisationMemberType) => user.role === ApiOrganisationMemberRoleChoices.Owner
    )

    const envs = [
      {
        name: 'devEnv',
        envType: ApiEnvironmentEnvTypeChoices.Dev,
        seed: await newEnvSeed(),
        salt: await newEnvSalt(),
        keys: {},
      },
      {
        name: 'stagingEnv',
        envType: ApiEnvironmentEnvTypeChoices.Staging,
        seed: await newEnvSeed(),
        salt: await newEnvSalt(),
        keys: { publicKey: '', privateKey: '' },
      },
      {
        name: 'prodEnv',
        envType: ApiEnvironmentEnvTypeChoices.Prod,
        seed: await newEnvSeed(),
        salt: await newEnvSalt(),
        keys: { publicKey: '', privateKey: '' },
      },
    ]

    let mutationPayload = {
      devEnv: {} as MutationCreateEnvironmentArgs,
      stagingEnv: {} as MutationCreateEnvironmentArgs,
      prodEnv: {} as MutationCreateEnvironmentArgs,
    }

    envs.forEach(async (env) => {
      env.keys = await envKeyring(env.seed)
      const { name, envType, seed, salt, keys } = env

      const ownerWrappedEnv = await wrapEnvSecretsForUser({ seed, salt }, owner)

      if (envType === ApiEnvironmentEnvTypeChoices.Dev) {
        mutationPayload.devEnv = {
          id: crypto.randomUUID(),
          appId: params.app,
          name,
          envType,
          wrappedSeed: ownerWrappedEnv.wrappedSeed,
          wrappedSalt: ownerWrappedEnv.wrappedSalt,
          identityKey: keys.publicKey,
        }
      } else if (envType === ApiEnvironmentEnvTypeChoices.Staging) {
        mutationPayload.stagingEnv = {
          id: crypto.randomUUID(),
          appId: params.app,
          name,
          envType,
          wrappedSeed: ownerWrappedEnv.wrappedSeed,
          wrappedSalt: ownerWrappedEnv.wrappedSalt,
          identityKey: keys.publicKey,
        }
      } else if (envType === ApiEnvironmentEnvTypeChoices.Prod) {
        mutationPayload.prodEnv = {
          id: crypto.randomUUID(),
          appId: params.app,
          name,
          envType,
          wrappedSeed: ownerWrappedEnv.wrappedSeed,
          wrappedSalt: ownerWrappedEnv.wrappedSalt,
          identityKey: keys.publicKey,
        }
      }
    })

    console.log(mutationPayload.devEnv)

    await createEnvironment({
      variables: mutationPayload.devEnv,
      refetchQueries: [
        {
          query: GetAppEnvironments,
          variables: {
            appId: params.app,
          },
        },
      ],
    })

    console.log(mutationPayload.stagingEnv)

    await createEnvironment({
      variables: mutationPayload.stagingEnv,
      refetchQueries: [
        {
          query: GetAppEnvironments,
          variables: {
            appId: params.app,
          },
        },
      ],
    })

    console.log(mutationPayload.prodEnv)

    await createEnvironment({
      variables: mutationPayload.prodEnv,
      refetchQueries: [
        {
          query: GetAppEnvironments,
          variables: {
            appId: params.app,
          },
        },
      ],
    })

    // await Promise.all([
    //   createEnvironment({
    //     variables: mutationPayload.devEnv,
    //     refetchQueries: [
    //       {
    //         query: GetAppEnvironments,
    //         variables: {
    //           appId: params.app,
    //         },
    //       },
    //     ],
    //   }),
    //   createEnvironment({
    //     variables: mutationPayload.stagingEnv,
    //     refetchQueries: [
    //       {
    //         query: GetAppEnvironments,
    //         variables: {
    //           appId: params.app,
    //         },
    //       },
    //     ],
    //   }),
    //   createEnvironment({
    //     variables: mutationPayload.prodEnv,
    //     refetchQueries: [
    //       {
    //         query: GetAppEnvironments,
    //         variables: {
    //           appId: params.app,
    //         },
    //       },
    //     ],
    //   }),
    // ])

    // const result = await initAppEnvironments({
    //   variables: mutationPayload,
    //   refetchQueries: [
    //     {
    //       query: GetAppEnvironments,
    //       variables: {
    //         appId: params.app,
    //       },
    //     },
    //   ],
    // })
  }

  const handleCreateNewUserToken = async () => {
    const sudoPass = 'testpassword1234'
    const deviceKey = await cryptoUtils.deviceVaultKey(sudoPass, session?.user?.email!)
    const encryptedKeyring = getLocalKeyring(orgsData.organisations[0].id)
    if (!encryptedKeyring) throw 'Error fetching local encrypted keys from browser'
    const decryptedKeyring = await cryptoUtils.decryptAccountKeyring(encryptedKeyring!, deviceKey)
    if (!decryptedKeyring) throw 'Failed to decrypt keys'

    const userKxKeys = {
      publicKey: await getUserKxPublicKey(decryptedKeyring.publicKey),
      privateKey: await getUserKxPrivateKey(decryptedKeyring.privateKey),
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
  }

  const EnvironmentCard = (props: { environment: EnvironmentType }) => {
    type EnvKeyring = {
      privateKey: string
      publicKey: string
      salt: string
    }

    const { environment } = props

    const [key, setKey] = useState<string>('')
    const [value, setValue] = useState<string>('')
    const [envKeys, setEnvKeys] = useState<EnvKeyring | null>(null)
    const [envToken, setEnvToken] = useState<string>('')
    const [createSecret, { data, loading, error }] = useMutation(CreateSecret)
    const [createEnvironmentToken] = useMutation(CreateEnvToken)
    const { data: secretsData } = useQuery(GetSecrets, {
      variables: {
        envId: environment.id,
      },
    })
    const { data: envTokensData } = useQuery(GetEnvironmentTokens, {
      variables: {
        envId: environment.id,
      },
    })
    const [secrets, setSecrets] = useState<SecretType[]>([])

    useEffect(() => {
      const initEnvKeys = async () => {
        await _sodium.ready
        const sodium = _sodium

        const sudoPass = 'testpassword1234'
        const deviceKey = await cryptoUtils.deviceVaultKey(sudoPass, session?.user?.email!)
        const encryptedKeyring = getLocalKeyring(orgsData.organisations[0].id)
        if (!encryptedKeyring) throw 'Error fetching local encrypted keys from browser'
        const decryptedKeyring = await cryptoUtils.decryptAccountKeyring(
          encryptedKeyring!,
          deviceKey
        )
        if (!decryptedKeyring) throw 'Failed to decrypt keys'

        const wrappedSeed = secretsData.environmentKeys[0].wrappedSeed

        const userKxKeys = {
          publicKey: await getUserKxPublicKey(decryptedKeyring.publicKey),
          privateKey: await getUserKxPrivateKey(decryptedKeyring.privateKey),
        }
        const seed = await decryptAsymmetric(
          wrappedSeed,
          userKxKeys.privateKey,
          userKxKeys.publicKey
        )

        const salt = await decryptAsymmetric(
          secretsData.environmentKeys[0].wrappedSalt,
          userKxKeys.privateKey,
          userKxKeys.publicKey
        )
        const { publicKey, privateKey } = await envKeyring(seed)

        setEnvKeys({
          publicKey,
          privateKey,
          salt,
        })
      }

      if (secretsData) initEnvKeys()
    }, [secretsData])

    useEffect(() => {
      if (secretsData && envKeys) {
        const decryptSecrets = async () => {
          const decryptedSecrets = await Promise.all(
            secretsData.secrets.map(async (secret: SecretType) => {
              const decryptedSecret = structuredClone(secret)
              decryptedSecret.key = await decryptAsymmetric(
                secret.key,
                envKeys?.privateKey,
                envKeys?.publicKey
              )
              decryptedSecret.value = await decryptAsymmetric(
                secret.value,
                envKeys.privateKey,
                envKeys.publicKey
              )
              const box = await createSealedBox(decryptedSecret.value, envKeys.publicKey)
              console.log('sealedBox', box)
              const openBox = await openSealedBox(box, envKeys.publicKey, envKeys.privateKey)
              console.log('openBox', openBox)
              return decryptedSecret
            })
          )
          return decryptedSecrets
        }

        decryptSecrets().then((decryptedSecrets) => {
          setSecrets(decryptedSecrets)
        })
      }
    }, [envKeys, secretsData])

    const decryptSecretField = async (encryptedField: string) => {
      const decryptedField = await decryptAsymmetric(
        encryptedField,
        envKeys!.privateKey,
        envKeys!.publicKey
      )
      return decryptedField
    }

    const handleCreateNewSecret = async () => {
      const encryptedKey = await encryptAsymmetric(key, environment.identityKey)
      const encryptedValue = await encryptAsymmetric(value, environment.identityKey)
      const keyDigest = await digest(key, envKeys!.salt)

      await createSecret({
        variables: {
          envId: environment.id,
          key: encryptedKey,
          keyDigest,
          value: encryptedValue,
        },
        refetchQueries: [
          {
            query: GetSecrets,
            variables: {
              envId: environment.id,
            },
          },
        ],
      })
      setKey('')
      setValue('')
    }

    const handleCreateNewEnvToken = async () => {
      const sudoPass = 'testpassword1234'
      const deviceKey = await cryptoUtils.deviceVaultKey(sudoPass, session?.user?.email!)
      const encryptedKeyring = getLocalKeyring(orgsData.organisations[0].id)
      if (!encryptedKeyring) throw 'Error fetching local encrypted keys from browser'
      const decryptedKeyring = await cryptoUtils.decryptAccountKeyring(encryptedKeyring!, deviceKey)
      if (!decryptedKeyring) throw 'Failed to decrypt keys'

      const userKxKeys = {
        publicKey: await getUserKxPublicKey(decryptedKeyring.publicKey),
        privateKey: await getUserKxPrivateKey(decryptedKeyring.privateKey),
      }

      const { pssEnv, mutationPayload } = await generateEnvironmentToken(
        environment,
        secretsData.environmentKeys[0],
        userKxKeys
      )

      const { pssUser } = await generateUserToken(orgsData.organisations[0].id, userKxKeys)

      console.log('user token', pssUser)

      await createEnvironmentToken({
        variables: mutationPayload,
        refetchQueries: [
          {
            query: GetEnvironmentTokens,
            variables: {
              envId: environment.id,
            },
          },
        ],
      })

      setEnvToken(pssEnv)
    }

    return (
      <div className="bg-zinc-800 rounded-lg flex flex-col gap-4 p-4" key={environment.id}>
        <div className="text-white font-semibold text-2xl">
          {environment.name}
          <span className="font-extralight text-neutral-500">{environment.envType}</span>
        </div>
        <div className="grid grid-cols-2 gap-2  divide-zinc-600">
          {envKeys !== null &&
            secrets.map((secret: SecretType) => (
              <div key={secret.id} className="grid grid-cols-2 col-span-2 gap-4 p-4">
                <div className="break-all">{secret.key}</div>
                <div className="break-all">{secret.value}</div>
              </div>
            ))}
          <div className="flex flex-col text-white border dark:border border-neutral-500">
            <label>Key</label>
            <input
              className=" bg-zinc-900"
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </div>
          <div className="flex flex-col text-white border dark:border border-neutral-500">
            <label>Value</label>
            <input
              className=" bg-zinc-900"
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div className="col-span-2 flex">
            <Button variant="primary" onClick={handleCreateNewSecret}>
              Create new secret
            </Button>
          </div>

          <div className="col-span-2 flex flex-col gap-2">
            {envTokensData?.environmentTokens.map((envToken: EnvironmentTokenType) => (
              <div key={envToken.id}>
                {envToken.name} | {envToken.createdAt}
              </div>
            ))}
            <code className="break-all p-2">{envToken}</code>
            <div>
              <Button variant="outline" onClick={handleCreateNewEnvToken}>
                Create new env token
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen w-full text-black dark:text-white grid grid-cols-1 md:grid-cols-3 gap-16">
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
          <div className="grid grid-cols-3 gap-4 divide-y divide-zinc-700">
            {data?.appEnvironments.map((env: EnvironmentType) => (
              <EnvironmentCard key={env.id} environment={env} />
            ))}
            <div>
              <Button variant="primary" onClick={initAppEnvs}>
                Create new env
              </Button>
            </div>

            <div className="col-span-2 flex flex-col gap-2">
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
          </div>
        )}
      </section>
    </div>
  )
}
