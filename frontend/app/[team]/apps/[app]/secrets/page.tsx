'use client'

import { GetAppEnvironments } from '@/apollo/queries/secrets/getAppEnvironments.gql'
import { GetSecrets } from '@/apollo/queries/secrets/getSecrets.gql'
import { GetOrganisations } from '@/apollo/queries/getOrganisations.gql'
import { GetOrganisationAdminsAndSelf } from '@/apollo/queries/organisation/getOrganisationAdminsAndSelf.gql'
import { CreateEnvironment } from '@/apollo/mutations/environments/createEnvironment.gql'
import { CreateEnvironmentKey } from '@/apollo/mutations/environments/createEnvironmentKey.gql'
import { CreateEnvironmentSecret } from '@/apollo/mutations/environments/createEnvironmentSecret.gql'
import { GetEnvironmentSecrets } from '@/apollo/queries/secrets/getEnvironmentSecrets.gql'
import { CreateSecret } from '@/apollo/mutations/environments/createSecret.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { useEffect, useState } from 'react'
import { copyToClipBoard } from '@/utils/clipboard'
import { toast } from 'react-toastify'
import { useSession } from 'next-auth/react'
import {
  envKeyring,
  generateEnvironmentSecret,
  newEnvSalt,
  newEnvSeed,
} from '@/utils/environments'
import { Button } from '@/components/common/Button'
import {
  ApiEnvironmentEnvTypeChoices,
  ApiOrganisationMemberRoleChoices,
  EnvironmentKeyType,
  EnvironmentSecretType,
  EnvironmentType,
  OrganisationMemberType,
  SecretType,
} from '@/apollo/graphql'
import {
  decryptAsymmetric,
  digest,
  encryptAsymmetric,
  getUserKxPrivateKey,
  getUserKxPublicKey,
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

  const [createEnvironment, { loading, error }] = useMutation(CreateEnvironment)
  const [createEnvironmentKey] = useMutation(CreateEnvironmentKey)

  const { data: session } = useSession()

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

  const wrapEnvSecretsForUser = async (
    envSecrets: { seed: string; salt: string },
    user: OrganisationMemberType
  ) => {
    const userPubKey = await getUserKxPublicKey(user.identityKey!)
    const wrappedSeed = await encryptAsymmetric(envSecrets.seed, userPubKey)
    const wrappedSalt = await encryptAsymmetric(envSecrets.salt, userPubKey)

    console.log({
      wrappedSeed,
      wrappedSalt,
    })

    return {
      user,
      wrappedSeed,
      wrappedSalt,
    }
  }

  const createEnv = async () => {
    const seed = await newEnvSeed()
    const keys = await envKeyring(seed)
    const salt = await newEnvSalt()
    const name = 'testEnv'
    const envType = ApiEnvironmentEnvTypeChoices.Dev

    const wrappedEnvSecrets = orgAdminsData.organisationAdminsAndSelf.map(
      async (user: OrganisationMemberType) => {
        const wrappedSeed = await encryptAsymmetric(seed, user.identityKey!)
        const wrappedSalt = await encryptAsymmetric(salt, user.identityKey!)

        console.log({
          wrappedSeed,
          wrappedSalt,
        })

        return {
          user,
          wrappedSeed,
          wrappedSalt,
        }
      }
    )

    const owner = orgAdminsData.organisationAdminsAndSelf.find(
      (user: OrganisationMemberType) => user.role === ApiOrganisationMemberRoleChoices.Owner
    )

    const ownerWrappedEnv = await wrapEnvSecretsForUser({ seed, salt }, owner)

    const envMutationPayload = {
      id: crypto.randomUUID(),
      appId: params.app,
      name,
      envType,
      wrappedSeed: ownerWrappedEnv.wrappedSeed,
      wrappedSalt: ownerWrappedEnv.wrappedSalt,
      identityKey: keys.publicKey,
    }

    const result = await createEnvironment({
      variables: envMutationPayload,
      refetchQueries: [
        {
          query: GetAppEnvironments,
          variables: {
            appId: params.app,
          },
        },
      ],
    })

    console.log(result)

    // if (result.data.createEnvironment.environment) {
    //   const envKeyMutationPayload = {
    //     envId: result.data.createEnvironment.environment.id,
    //     ownerId: owner.id,
    //     wrappedSeed: ownerWrappedEnv.wrappedSeed,
    //     wrappedSalt: ownerWrappedEnv.wrappedSalt,
    //     identityKey: keys.publicKey,
    //   }

    //   const keyResult = await createEnvironmentKey({
    //     variables: envKeyMutationPayload,
    //   })

    //   console.log(keyResult)
    // }
  }

  const EnvironmentCard = (props: { environment: EnvironmentType }) => {
    type EnvKeyring = {
      privateKey: string
      publicKey: string
    }

    const { environment } = props

    const [key, setKey] = useState<string>('')
    const [value, setValue] = useState<string>('')
    const [envKeys, setEnvKeys] = useState<EnvKeyring | null>(null)
    const [envSecret, setEnvSecret] = useState<string>('')
    const [createSecret, { data, loading, error }] = useMutation(CreateSecret)
    const [createEnvironmentSecret] = useMutation(CreateEnvironmentSecret)
    const { data: secretsData } = useQuery(GetSecrets, {
      variables: {
        envId: environment.id,
      },
    })
    const { data: envSecretsData } = useQuery(GetEnvironmentSecrets, {
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

        const { publicKey, privateKey } = await envKeyring(seed)

        setEnvKeys({
          publicKey,
          privateKey,
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
      const keyDigest = await digest(key)

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

    const handleCreateNewEnvSecret = async () => {
      const sudoPass = 'testpassword1234'
      const deviceKey = await cryptoUtils.deviceVaultKey(sudoPass, session?.user?.email!)
      const encryptedKeyring = getLocalKeyring(orgsData.organisations[0].id)
      if (!encryptedKeyring) throw 'Error fetching local encrypted keys from browser'
      const decryptedKeyring = await cryptoUtils.decryptAccountKeyring(encryptedKeyring!, deviceKey)
      if (!decryptedKeyring) throw 'Failed to decrypt keys'

      const wrappedSeed = secretsData.environmentKeys[0].wrappedSeed

      const userKxKeys = {
        publicKey: await getUserKxPublicKey(decryptedKeyring.publicKey),
        privateKey: await getUserKxPrivateKey(decryptedKeyring.privateKey),
      }

      const { pssEnv, mutationPayload } = await generateEnvironmentSecret(
        environment,
        secretsData.environmentKeys[0],
        userKxKeys
      )

      await createEnvironmentSecret({
        variables: mutationPayload,
        refetchQueries: [
          {
            query: GetEnvironmentSecrets,
            variables: {
              envId: environment.id
            }
          }
        ]
      })

      setEnvSecret(pssEnv)
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
            {envSecretsData?.environmentSecrets.map((envSecret: EnvironmentSecretType) => (
              <div key={envSecret.id}>
                {envSecret.name} | {envSecret.createdAt}
              </div>
            ))}
            <code className="break-all p-2">{envSecret}</code>
            <div>
              <Button variant="outline" onClick={handleCreateNewEnvSecret}>
                Create new `pss_env` secret
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
            <Button variant="primary" onClick={createEnv}>
              Get started
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4 divide-y divide-zinc-700">
            {data?.appEnvironments.map((env: EnvironmentType) => (
              <EnvironmentCard key={env.id} environment={env} />
            ))}
            <div>
              <Button variant="primary" onClick={createEnv}>
                Create new env
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
