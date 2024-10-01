'use client'

import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvSecretsKV } from '@/graphql/queries/secrets/getSecretKVs.gql'
import { InitAppEnvironments } from '@/graphql/mutations/environments/initAppEnvironments.gql'
import { GetGlobalAccessUsers } from '@/graphql/queries/organisation/getGlobalAccessUsers.gql'
import { LogSecretReads } from '@/graphql/mutations/environments/readSecret.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { useContext, useEffect, useState } from 'react'
import {
  ApiEnvironmentEnvTypeChoices,
  ApiOrganisationPlanChoices,
  EnvironmentType,
  SecretFolderType,
  SecretType,
} from '@/apollo/graphql'
import _sodium from 'libsodium-wrappers-sumo'
import { KeyringContext } from '@/contexts/keyringContext'

import {
  FaArrowRight,
  FaBan,
  FaCheckCircle,
  FaChevronRight,
  FaCircle,
  FaCopy,
  FaExchangeAlt,
  FaExternalLinkAlt,
  FaFolder,
  FaRegEye,
  FaRegEyeSlash,
  FaSearch,
  FaTimesCircle,
} from 'react-icons/fa'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { organisationContext } from '@/contexts/organisationContext'
import { Button } from '@/components/common/Button'
import clsx from 'clsx'
import { Disclosure, Transition } from '@headlessui/react'
import { copyToClipBoard } from '@/utils/clipboard'
import { toast } from 'react-toastify'
import { userHasPermission, userIsAdmin } from '@/utils/access/permissions'
import Spinner from '@/components/common/Spinner'
import { Card } from '@/components/common/Card'
import { BsListColumnsReverse } from 'react-icons/bs'
import { unwrapEnvSecretsForUser, decryptEnvSecretKVs, createNewEnv } from '@/utils/crypto'
import { ManageEnvironmentDialog } from '@/components/environments/ManageEnvironmentDialog'
import { CreateEnvironmentDialog } from '@/components/environments/CreateEnvironmentDialog'
import { SwapEnvOrder } from '@/graphql/mutations/environments/swapEnvironmentOrder.gql'
import { EmptyState } from '@/components/common/EmptyState'

type EnvSecrets = {
  env: EnvironmentType
  secrets: SecretType[]
}

type EnvFolders = {
  env: EnvironmentType
  folders: SecretFolderType[]
}

type AppSecret = {
  key: string
  envs: Array<{
    env: Partial<EnvironmentType>
    secret: SecretType | null
  }>
}

type AppFolder = {
  name: string
  envs: Array<{
    env: Partial<EnvironmentType>
    folder: SecretFolderType | null
  }>
}

const Environments = (props: { environments: EnvironmentType[]; appId: string }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanCreateEnvironments = userHasPermission(
    organisation?.role?.permissions,
    'Environments',
    'create',
    true
  )

  const userCanUpdateEnvironments = userHasPermission(
    organisation?.role?.permissions,
    'Environments',
    'update',
    true
  )

  const allowReordering =
    organisation?.plan !== ApiOrganisationPlanChoices.Fr && userCanUpdateEnvironments

  const { environments, appId } = props

  const pathname = usePathname()

  const [swapEnvs, { loading }] = useMutation(SwapEnvOrder)

  const handleSwapEnvironments = async (env1: EnvironmentType, env2: EnvironmentType) => {
    await swapEnvs({
      variables: { environment1Id: env1.id, environment2Id: env2?.id },
      refetchQueries: [{ query: GetAppEnvironments, variables: { appId } }],
    })
  }

  return (
    <div className="grid grid-cols-4 gap-4 py-4">
      {environments.map((env: EnvironmentType, index: number) => (
        <Card key={env.id}>
          <div className="group">
            <div className="flex gap-4">
              <div className="pt-1.5">
                <BsListColumnsReverse className="text-black dark:text-white text-2xl" />
              </div>
              <div className="space-y-6 w-full">
                <div className="flex items-start justify-between">
                  <Link href={`${pathname}/environments/${env.id}`} className="group">
                    <div className="font-semibold text-lg">{env.name}</div>
                    <div className="text-neutral-500">
                      {env.secretCount} secrets across {env.folderCount} folders
                    </div>
                  </Link>
                  <ManageEnvironmentDialog environment={env} />
                </div>

                <div className="flex items-center">
                  <Link href={`${pathname}/environments/${env.id}`}>
                    <Button variant="primary">
                      Explore <FaArrowRight />
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
            {allowReordering && (
              <div className="flex justify-between items-center opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto">
                <div>
                  {index !== 0 && (
                    <Button
                      variant="secondary"
                      disabled={loading}
                      title={`Swap with ${environments[index - 1].name}`}
                      onClick={() => handleSwapEnvironments(env, environments[index - 1])}
                    >
                      <FaExchangeAlt className="text-xs shrink-0" />
                    </Button>
                  )}
                </div>
                <div>
                  {index !== environments.length - 1 && (
                    <Button
                      variant="secondary"
                      disabled={loading}
                      title={`Swap with ${environments[index + 1].name}`}
                      onClick={() => handleSwapEnvironments(env, environments[index + 1])}
                    >
                      <FaExchangeAlt className="text-xs shrink-0" />
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>
      ))}
      {userCanCreateEnvironments && (
        <Card>
          <div className="flex flex-col w-full h-full">
            <div className="mx-auto my-auto">
              <CreateEnvironmentDialog appId={appId} />
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

export default function Secrets({ params }: { params: { team: string; app: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanReadEnvironments = userHasPermission(
    organisation?.role?.permissions,
    'Environments',
    'read',
    true
  )
  const userCanReadSecrets = userHasPermission(
    organisation?.role?.permissions,
    'Secrets',
    'read',
    true
  )
  const userCanReadMembers = userHasPermission(organisation?.role?.permissions, 'Members', 'read')

  const { data } = useQuery(GetAppEnvironments, {
    variables: {
      appId: params.app,
    },
    fetchPolicy: 'cache-and-network',
    skip: !userCanReadEnvironments,
  })

  const { data: orgAdminsData } = useQuery(GetGlobalAccessUsers, {
    variables: {
      organisationId: organisation?.id,
    },
    skip: !organisation || !userCanReadMembers,
  })

  const pathname = usePathname()

  const [getEnvSecrets] = useLazyQuery(GetEnvSecretsKV)

  const [appSecrets, setAppSecrets] = useState<AppSecret[]>([])
  const [appFolders, setAppFolders] = useState<AppFolder[]>([])
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [initAppEnvironments] = useMutation(InitAppEnvironments)

  const [loading, setLoading] = useState(false)

  const { keyring } = useContext(KeyringContext)

  const activeUserIsAdmin = organisation ? userIsAdmin(organisation.role!.name!) : false

  const filteredSecrets =
    searchQuery === ''
      ? appSecrets
      : appSecrets.filter((secret) => {
          const searchRegex = new RegExp(searchQuery, 'i')
          return searchRegex.test(secret.key)
        })

  const filteredFolders =
    searchQuery === ''
      ? appFolders
      : appFolders.filter((folder) => {
          const searchRegex = new RegExp(searchQuery, 'i')
          return searchRegex.test(folder.name)
        })

  useEffect(() => {
    const fetchAndDecryptAppEnvs = async (appEnvironments: EnvironmentType[]) => {
      setLoading(true)
      const envSecrets = [] as EnvSecrets[]
      const envFolders = [] as EnvFolders[]

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
        envFolders.push({ env, folders: data.folders })
      }

      // Create a list of unique secret keys
      const secretKeys = Array.from(
        new Set(envSecrets.flatMap((envCard) => envCard.secrets.map((secret) => secret.key)))
      )

      // Create a list of unique folder names
      const folderNames = Array.from(
        new Set(envFolders.flatMap((envCard) => envCard.folders.map((folder) => folder.name)))
      )

      // Transform envCards into an array of AppSecret objects
      const appSecrets = secretKeys.map((key) => {
        const envs = envSecrets.map((envCard) => ({
          env: envCard.env,
          secret: envCard.secrets.find((secret) => secret.key === key) || null,
        }))
        return { key, envs }
      })

      // Transform envFolders into an array of AppFolder objects
      const appFolders = folderNames.map((name) => {
        const envs = envFolders.map((envCard) => ({
          env: envCard.env,
          folder: envCard.folders.find((folder) => folder.name === name) || null,
        }))
        return { name, envs }
      })

      setAppSecrets(appSecrets)
      setAppFolders(appFolders)
      setLoading(false)
    }

    if (keyring !== null && data?.appEnvironments && userCanReadSecrets)
      fetchAndDecryptAppEnvs(data?.appEnvironments)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.appEnvironments, keyring])

  const initAppEnvs = async () => {
    const mutationPayload = {
      devEnv: await createNewEnv(
        params.app,
        'Development',
        ApiEnvironmentEnvTypeChoices.Dev,
        orgAdminsData.organisationGlobalAccessUsers
      ),
      stagingEnv: await createNewEnv(
        params.app,
        'Staging',
        ApiEnvironmentEnvTypeChoices.Staging,
        orgAdminsData.organisationGlobalAccessUsers
      ),
      prodEnv: await createNewEnv(
        params.app,
        'Production',
        ApiEnvironmentEnvTypeChoices.Prod,
        orgAdminsData.organisationGlobalAccessUsers
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

  const setupRequired = data?.appEnvironments.length === 0 ?? true

  const EnvSecret = (props: {
    envSecret: {
      env: Partial<EnvironmentType>
      secret: SecretType | null
    }
    sameAsProd: boolean
  }) => {
    const { envSecret, sameAsProd } = props

    const [readSecret] = useMutation(LogSecretReads)

    const [showValue, setShowValue] = useState<boolean>(false)

    const handleRevealSecret = async () => {
      setShowValue(true)
      await readSecret({ variables: { ids: [envSecret.secret!.id] } })
    }

    const handleHideSecret = () => setShowValue(false)

    const toggleShowValue = () => {
      showValue ? handleHideSecret() : handleRevealSecret()
    }

    const handleCopy = async (val: string) => {
      copyToClipBoard(val)
      toast.info('Copied', { autoClose: 2000 })
      await readSecret({ variables: { ids: [envSecret.secret!.id] } })
    }

    return (
      <div className="py-2 px-4">
        <div>
          <Link
            className="flex items-center gap-2 w-min group font-medium text-gray-500 uppercase tracking-wider text-xs"
            href={`${pathname}/environments/${envSecret.env.id}${
              envSecret.secret ? `?secret=${envSecret.secret?.id}` : ``
            }`}
            title={
              envSecret.secret
                ? `View this secret in ${envSecret.env.envType}`
                : `Manage ${envSecret.env.envType}`
            }
          >
            <div>{envSecret.env.envType}</div>
            <FaExternalLinkAlt className="opacity-0 group-hover:opacity-100 transition ease" />
          </Link>
        </div>

        {envSecret.secret === null ? (
          <span className="text-red-500 font-mono uppercase">missing</span>
        ) : envSecret.secret.value.length === 0 ? (
          <span className="text-neutral-500 font-mono uppercase">blank</span>
        ) : (
          <div className="flex justify-between items-center w-full">
            <code
              className={clsx(
                'break-all whitespace-break-spaces max-w-full ph-no-capture',
                sameAsProd ? 'text-amber-500' : 'text-emerald-500'
              )}
            >
              {showValue ? (
                <pre>{envSecret.secret.value}</pre>
              ) : (
                <span>{'*'.repeat(envSecret.secret.value.length)}</span>
              )}
            </code>

            {envSecret.secret !== null && (
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={() => handleCopy(envSecret.secret!.value)}>
                  <FaCopy /> Copy
                </Button>
                <Button variant="outline" onClick={toggleShowValue}>
                  {showValue ? <FaRegEyeSlash /> : <FaRegEye />}
                  {showValue ? 'Hide' : 'Show'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  const EnvFolder = (props: {
    envFolder: {
      env: Partial<EnvironmentType>
      folder: SecretFolderType | null
    }
  }) => {
    const { envFolder } = props

    return (
      <div className="py-2 px-4">
        {envFolder.folder === null ? (
          <span className="text-red-500 font-mono">missing</span>
        ) : (
          <Link
            className="flex items-center gap-2 w-min group font-medium text-sm tracking-wider"
            href={`${pathname}/environments/${envFolder.env.id}${
              envFolder.folder ? `/${envFolder.folder.name}` : ``
            }`}
            title={
              envFolder.folder
                ? `View this folder in ${envFolder.env.envType}`
                : `Manage ${envFolder.env.envType}`
            }
          >
            <div className="flex items-center gap-4">
              <span className="text-gray-500">{envFolder.env.envType}</span>{' '}
              <span className="text-emerald-500">/{envFolder.folder.name}</span>
            </div>
          </Link>
        )}
      </div>
    )
  }

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
      <Disclosure>
        {({ open }) => (
          <>
            <Disclosure.Button
              as="tr"
              className={clsx(
                'group divide-x divide-neutral-500/40 border-x transition ease duration-100 cursor-pointer ',
                open
                  ? 'bg-zinc-100 dark:bg-zinc-800 !border-l-emerald-500 !border-r-neutral-500/40'
                  : ' hover:bg-zinc-100 dark:hover:bg-zinc-800 border-neutral-500/40'
              )}
            >
              <td
                className={clsx(
                  'px-6 py-3 whitespace-nowrap font-mono text-zinc-800 dark:text-zinc-300 flex items-center gap-2 ph-no-capture',
                  open ? 'font-bold' : 'font-medium'
                )}
              >
                {appSecret.key}
                <FaChevronRight
                  className={clsx(
                    'transform transition ease font-light',
                    open ? 'opacity-100 rotate-90' : 'opacity-0 group-hover:opacity-100 rotate-0'
                  )}
                />
              </td>
              {appSecret.envs.map((env) => (
                <td key={env.env.id} className="px-6 py-3 whitespace-nowrap group">
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
            </Disclosure.Button>
            <Transition
              as="tr"
              enter="transition duration-100 ease-out"
              enterFrom="transform scale-95 opacity-0"
              enterTo="transform scale-100 opacity-100"
              leave="transition duration-75 ease-out"
              leaveFrom="transform scale-100 opacity-100"
              leaveTo="transform scale-95 opacity-0"
              className={clsx(
                'border-x',
                open
                  ? ' !border-l-emerald-500 !border-r-neutral-500/40 shadow-xl '
                  : 'border-neutral-500/40'
              )}
            >
              <td
                colSpan={appSecret.envs.length + 1}
                className={clsx('p-2 space-y-6 bg-zinc-100 dark:bg-zinc-800')}
              >
                <Disclosure.Panel>
                  <div className="grid gap-2 divide-y divide-neutral-500/20">
                    {appSecret.envs.map((envSecret) => (
                      <EnvSecret
                        key={envSecret.env.id}
                        envSecret={envSecret}
                        sameAsProd={secretIsSameAsProd(envSecret)}
                      />
                    ))}
                  </div>
                </Disclosure.Panel>
              </td>
            </Transition>
          </>
        )}
      </Disclosure>
    )
  }

  const AppFolderRow = (props: { appFolder: AppFolder }) => {
    const { appFolder } = props

    // Assuming folder presence doesn't vary by environment in the same way as secrets,
    // adjust logic according to your requirements for folders
    const tooltipText = (env: {
      env: Partial<EnvironmentType>
      folder: SecretFolderType | null
    }) => {
      if (env.folder === null) return `This folder is missing in ${env.env.envType}`
      else return 'This folder is present'
    }

    return (
      <Disclosure>
        {({ open }) => (
          <>
            <Disclosure.Button
              as="tr"
              className={clsx(
                'group divide-x divide-neutral-500/40 border-x transition ease duration-100 cursor-pointer',
                open
                  ? 'bg-zinc-100 dark:bg-zinc-800 !border-l-emerald-500 !border-r-neutral-500/40'
                  : ' hover:bg-zinc-100 dark:hover:bg-zinc-800 border-neutral-500/40'
              )}
            >
              <td
                className={clsx(
                  'px-6 py-3 whitespace-nowrap font-mono text-zinc-800 dark:text-zinc-300 flex items-center gap-2 ph-no-capture',
                  open ? 'font-bold' : 'font-medium'
                )}
              >
                <FaFolder className="text-emerald-500" />
                {appFolder.name}
                <FaChevronRight
                  className={clsx(
                    'transform transition ease font-light',
                    open ? 'opacity-100 rotate-90' : 'opacity-0 group-hover:opacity-100 rotate-0'
                  )}
                />
              </td>
              {appFolder.envs.map((env) => (
                <td key={env.env.id} className="px-6 py-3 whitespace-nowrap">
                  <div className="flex items-center justify-center" title={tooltipText(env)}>
                    {env.folder !== null ? (
                      <FaCheckCircle className="text-emerald-500 shrink-0" />
                    ) : (
                      <FaTimesCircle className="text-red-500 shrink-0" />
                    )}
                  </div>
                </td>
              ))}
            </Disclosure.Button>
            <Transition
              as="tr"
              enter="transition duration-100 ease-out"
              enterFrom="transform scale-95 opacity-0"
              enterTo="transform scale-100 opacity-100"
              leave="transition duration-75 ease-out"
              leaveFrom="transform scale-100 opacity-100"
              leaveTo="transform scale-95 opacity-0"
              className={clsx(
                'border-x',
                open
                  ? ' !border-l-emerald-500 !border-r-neutral-500/40 shadow-xl '
                  : 'border-neutral-500/40'
              )}
            >
              <td
                colSpan={appFolder.envs.length + 1}
                className={clsx('p-2 space-y-6 bg-zinc-100 dark:bg-zinc-800')}
              >
                <Disclosure.Panel>
                  <div className="grid gap-2 divide-y divide-neutral-500/20">
                    {appFolder.envs.map((envFolder) => (
                      <EnvFolder key={envFolder.env.id} envFolder={envFolder} />
                    ))}
                  </div>
                </Disclosure.Panel>
              </td>
            </Transition>
          </>
        )}
      </Disclosure>
    )
  }

  return (
    <div className="max-h-screen overflow-y-auto w-full text-black dark:text-white grid gap-16 relative">
      {keyring !== null &&
        (setupRequired ? (
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
          <section className="space-y-8 py-4">
            <div className="space-y-2">
              <div className="space-y-1">
                <h1 className="h3 font-semibold text-2xl">Environments</h1>
                {userCanReadEnvironments ? (
                  <p className="text-neutral-500">
                    You have access to {data?.appEnvironments.length} Environments in this App.
                  </p>
                ) : (
                  <EmptyState
                    title="Access restricted"
                    subtitle="You don't have the permissions required to view Environments in this app."
                    graphic={
                      <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                        <FaBan />
                      </div>
                    }
                  >
                    <></>
                  </EmptyState>
                )}
              </div>
            </div>

            {data?.appEnvironments && (
              <Environments environments={data.appEnvironments} appId={params.app} />
            )}

            <hr className="border-neutral-500/40" />

            <div className="space-y-2">
              <div className="space-y-1">
                <h1 className="h3 font-semibold text-2xl">Secrets</h1>
                <p className="text-neutral-500">
                  An overview of Secrets across all Environments in this App. Expand a row in the
                  table below to compare values across Environments.
                </p>
              </div>
            </div>

            <div className="flex items-center w-full justify-between border-b border-neutral-500/20 pb-4">
              <div className="relative flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md px-2">
                <div className="">
                  <FaSearch className="text-neutral-500" />
                </div>
                <input
                  placeholder="Search"
                  className="custom bg-zinc-100 dark:bg-zinc-800"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <FaTimesCircle
                  className={clsx(
                    'cursor-pointer text-neutral-500 transition-opacity ease',
                    searchQuery ? 'opacity-100' : 'opacity-0'
                  )}
                  role="button"
                  onClick={() => setSearchQuery('')}
                />
              </div>

              <div className="flex items-center justify-end gap-8 p-4 text-neutral-500">
                <div className="flex items-center gap-2">
                  <FaCheckCircle className="text-emerald-500 shrink-0" /> Secret is present
                </div>
                <div className="flex items-center gap-2">
                  <FaCheckCircle className="text-amber-500 shrink-0" /> Secret is the same as
                  Production
                </div>
                <div className="flex items-center gap-2">
                  <FaCircle className="text-neutral-500 shrink-0" /> Secret is blank
                </div>
                <div className="flex items-center gap-2">
                  <FaTimesCircle className="text-red-500 shrink-0" /> Secret is missing
                </div>
              </div>
            </div>

            {appSecrets.length > 0 || appFolders.length > 0 ? (
              <table className="table-auto w-full border border-neutral-500/40">
                <thead id="table-head" className="sticky top-0 bg-zinc-300 dark:bg-zinc-800 z-10">
                  <tr className="divide-x divide-neutral-500/40">
                    <th className="px-6 py-2 text-left text-sm font-medium text-gray-500 uppercase tracking-wider">
                      key
                    </th>
                    {data?.appEnvironments.map((env: EnvironmentType) => (
                      <th
                        key={env.id}
                        className="group text-center text-sm font-semibold uppercase tracking-widest py-3 w-60"
                      >
                        <Link href={`${pathname}/environments/${env.id}`}>
                          <Button variant="outline">
                            <div className="flex items-center gap-2 justify-center ">
                              {env.name}
                              <div className="opacity-30 group-hover:opacity-100 transform -translate-x-1 group-hover:translate-x-0 transition ease">
                                <FaArrowRight />
                              </div>
                            </div>
                          </Button>
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-500/40">
                  {filteredFolders.map((appFolder) => (
                    <AppFolderRow key={appFolder.name} appFolder={appFolder} />
                  ))}

                  {filteredSecrets.map((appSecret, index) => (
                    <AppSecretRow key={`${appSecret.key}${index}`} appSecret={appSecret} />
                  ))}
                </tbody>
              </table>
            ) : loading ? (
              <div className="w-full flex justify-center py-80">
                <Spinner size="xl" />
              </div>
            ) : userCanReadEnvironments && userCanReadSecrets ? (
              <div className="flex flex-col items-center py-40 border border-neutral-500/40 rounded-md bg-neutral-100 dark:bg-neutral-800">
                <div className="font-semibold text-black dark:text-white text-2xl">No Secrets</div>
                <div className="text-neutral-500">
                  There are no secrets in this app yet. Click on an environment below to start
                  adding secrets.
                </div>
                <div className="flex items-center gap-4 mt-8">
                  {data?.appEnvironments.map((env: EnvironmentType) => (
                    <Link key={env.id} href={`${pathname}/environments/${env.id}`}>
                      <Button variant="primary">
                        <div className="flex items-center gap-2 justify-center text-xl group">
                          {env.name}
                          <div className="opacity-30 group-hover:opacity-100 transform -translate-x-1 group-hover:translate-x-0 transition ease">
                            <FaArrowRight />
                          </div>
                        </div>
                      </Button>
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyState
                title="Access restricted"
                subtitle="You don't have the permissions required to view Secrets in this app."
                graphic={
                  <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                    <FaBan />
                  </div>
                }
              >
                <></>
              </EmptyState>
            )}
          </section>
        ))}
    </div>
  )
}
