import { CreateNewUserToken } from '@/graphql/mutations/users/createUserToken.gql'
import { RevokeUserToken } from '@/graphql/mutations/users/deleteUserToken.gql'
import { RevokeServiceToken } from '@/graphql/mutations/environments/deleteServiceToken.gql'
import { CreateNewServiceToken } from '@/graphql/mutations/environments/createServiceToken.gql'
import { GetUserTokens } from '@/graphql/queries/users/getUserTokens.gql'
import { GetServiceTokens } from '@/graphql/queries/secrets/getServiceTokens.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import {
  generateUserToken,
  newEnvToken,
  newEnvWrapKey,
  newServiceTokenKeys,
  unwrapEnvSecretsForUser,
  wrapEnvSecretsForServiceToken,
} from '@/utils/environments'
import { EnvironmentType, ServiceTokenType, UserTokenType } from '@/apollo/graphql'
import { cryptoUtils } from '@/utils/auth'
import { getUserKxPublicKey, getUserKxPrivateKey } from '@/utils/crypto'
import { splitSecret } from '@/utils/keyshares'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { useState, useEffect, useContext, Fragment } from 'react'
import { KeyringContext } from '@/contexts/keyringContext'
import { Button } from '@/components/common/Button'
import {
  FaCheckSquare,
  FaChevronDown,
  FaExclamationTriangle,
  FaKey,
  FaPlus,
  FaSquare,
  FaTimes,
  FaTrashAlt,
  FaUserLock,
  FaUserSecret,
} from 'react-icons/fa'
import { relativeTimeFromDates } from '@/utils/time'
import { Dialog, Listbox, Transition } from '@headlessui/react'
import { copyToClipBoard } from '@/utils/clipboard'
import { MdContentCopy } from 'react-icons/md'
import { toast } from 'react-toastify'
import clsx from 'clsx'

const handleCopy = (val: string) => {
  copyToClipBoard(val)
  toast.info('Copied', {
    autoClose: 2000,
  })
}

const CreateUserTokenDialog = (props: { organisationId: string }) => {
  const { organisationId } = props

  const { keyring } = useContext(KeyringContext)

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [name, setName] = useState<string>('')
  const [userToken, setUserToken] = useState<string>('')
  const [createUserToken] = useMutation(CreateNewUserToken)

  const reset = () => {
    setName('')
    setUserToken('')
  }

  const closeModal = () => {
    reset()
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const handleCreateNewUserToken = async () => {
    if (name.length === 0) {
      toast.error('You must enter a name for the token')
      return false
    }

    if (keyring) {
      const userKxKeys = {
        publicKey: await getUserKxPublicKey(keyring.publicKey),
        privateKey: await getUserKxPrivateKey(keyring.privateKey),
      }

      const { pssUser, mutationPayload } = await generateUserToken(organisationId, userKxKeys, name)

      await createUserToken({
        variables: mutationPayload,
        refetchQueries: [
          {
            query: GetUserTokens,
            variables: {
              organisationId,
            },
          },
        ],
      })

      setUserToken(pssUser)
    } else {
      console.log('keyring unavailable')
    }
  }

  return (
    <>
      <div className="flex items-center">
        <Button variant="primary" onClick={openModal} title="Delete secret">
          <div className="flex items-center gap-1">
            <FaPlus /> Create User Token
          </div>
        </Button>
      </div>

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={() => {}}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/25 backdrop-blur-md" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                      Create a new User token
                    </h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  {userToken ? (
                    <div className="py-4">
                      <div className="bg-blue-200 dark:bg-blue-400/10 shadow-inner p-3 rounded-lg">
                        <div className="w-full flex items-center justify-between pb-4">
                          <span className="uppercase text-xs tracking-widest text-gray-500">
                            user token
                          </span>
                          <div className="flex gap-4">
                            {userToken && (
                              <div className="rounded-lg bg-amber-800/30 text-amber-500 p-2 flex items-center gap-4">
                                <FaExclamationTriangle />
                                <div className="text-2xs">
                                  {"Copy this value. You won't see it again!"}
                                </div>
                              </div>
                            )}
                            {userToken && (
                              <Button variant="outline" onClick={() => handleCopy(userToken)}>
                                <MdContentCopy /> Copy
                              </Button>
                            )}
                          </div>
                        </div>
                        <code className="text-xs break-all text-blue-500">{userToken}</code>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6 p-4">
                      <div className="space-y-2 w-full">
                        <label
                          className="block text-gray-700 text-sm font-bold mb-2"
                          htmlFor="name"
                        >
                          Token name
                        </label>
                        <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                      </div>
                      <div className="flex items-center gap-4">
                        <Button variant="secondary" type="button" onClick={closeModal}>
                          Cancel
                        </Button>
                        <Button variant="primary" onClick={handleCreateNewUserToken}>
                          Create
                        </Button>
                      </div>
                    </div>
                  )}
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}

const CreateServiceTokenDialog = (props: { organisationId: string; appId: string }) => {
  const { organisationId, appId } = props

  const { keyring } = useContext(KeyringContext)

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [name, setName] = useState<string>('')
  const [envScope, setEnvScope] = useState<Array<Record<string, string>>>([])
  const [serviceToken, setServiceToken] = useState<string>('')

  const { data } = useQuery(GetAppEnvironments, {
    variables: {
      appId,
    },
  })
  const [getEnvKey] = useLazyQuery(GetEnvironmentKey)
  const [createServiceToken] = useMutation(CreateNewServiceToken)

  const reset = () => {
    setName('')
    setEnvScope([])
    setServiceToken('')
  }

  const closeModal = () => {
    reset()
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const envOptions =
    data?.appEnvironments.map((env: EnvironmentType) => {
      const { id, name } = env

      return {
        id,
        name,
      }
    }) ?? []

  const handleCreateNewServiceToken = async () => {
    if (name.length === 0) {
      toast.error('You must enter a name for the token')
      return false
    }

    if (envScope.length === 0) {
      toast.error('The token must be scoped to atleast one environment')
      return false
    }

    if (keyring) {
      const appEnvironments = data.appEnvironments as EnvironmentType[]

      const token = await newEnvToken()
      const wrapKey = await newEnvWrapKey()

      const tokenKeys = await newServiceTokenKeys()
      const keyShares = await splitSecret(tokenKeys.privateKey)
      const wrappedKeyShare = await cryptoUtils.wrappedKeyShare(keyShares[1], wrapKey)

      const pssService = `pss_service:v1:${token}:${tokenKeys.publicKey}:${keyShares[0]}:${wrapKey}`

      const envKeyPromises = appEnvironments
        .filter((env) => envScope.map((selectedEnv) => selectedEnv.id).includes(env.id))
        .map(async (env: EnvironmentType) => {
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
          appId,
          environmentKeys: envKeyInputs,
          identityKey: tokenKeys.publicKey,
          token,
          wrappedKeyShare,
          name,
          expiry: null,
        },
        refetchQueries: [
          {
            query: GetServiceTokens,
            variables: {
              appId,
            },
          },
        ],
      })

      setServiceToken(pssService)
    }
  }

  return (
    <>
      <div className="flex items-center">
        <Button variant="primary" onClick={openModal} title="Delete secret">
          <div className="flex items-center gap-1">
            <FaPlus /> Create Service Token
          </div>
        </Button>
      </div>

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={() => {}}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/25 backdrop-blur-md" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                      Create a new Service token
                    </h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  {serviceToken ? (
                    <div className="py-4">
                      <div className="bg-purple-200 dark:bg-purple-400/10 shadow-inner p-3 rounded-lg">
                        <div className="w-full flex items-center justify-between pb-4">
                          <span className="uppercase text-xs tracking-widest text-gray-500">
                            service token
                          </span>
                          <div className="flex gap-4">
                            {serviceToken && (
                              <div className="rounded-lg bg-amber-800/30 text-amber-500 p-2 flex items-center gap-4">
                                <FaExclamationTriangle />
                                <div className="text-2xs">
                                  {"Copy this value. You won't see it again!"}
                                </div>
                              </div>
                            )}
                            {serviceToken && (
                              <Button variant="outline" onClick={() => handleCopy(serviceToken)}>
                                <MdContentCopy /> Copy
                              </Button>
                            )}
                          </div>
                        </div>
                        <code className="text-xs break-all text-purple-500">{serviceToken}</code>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6 p-4">
                      <div className="space-y-1 w-full">
                        <label
                          className="block text-gray-700 text-sm font-bold mb-2"
                          htmlFor="name"
                        >
                          Token name
                        </label>
                        <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                      </div>

                      <div className="space-y-1 w-full">
                        <Listbox value={envScope} by="id" onChange={setEnvScope} multiple>
                          {({ open }) => (
                            <>
                              <Listbox.Label as={Fragment}>
                                <label
                                  className="block text-gray-700 text-sm font-bold mb-2"
                                  htmlFor="name"
                                >
                                  Environment scope
                                </label>
                              </Listbox.Label>
                              <Listbox.Button as={Fragment}>
                                <div className="p-2 flex items-center justify-between bg-zinc-300 dark:bg-zinc-800 rounded-md cursor-pointer h-10">
                                  {envScope
                                    .map((env: Partial<EnvironmentType>) => env.name)
                                    .join(' + ')}
                                  <FaChevronDown
                                    className={clsx(
                                      'transition-transform ease duration-300',
                                      open ? 'rotate-180' : 'rotate-0'
                                    )}
                                  />
                                </div>
                              </Listbox.Button>
                              <Transition
                                enter="transition duration-100 ease-out"
                                enterFrom="transform scale-95 opacity-0"
                                enterTo="transform scale-100 opacity-100"
                                leave="transition duration-75 ease-out"
                                leaveFrom="transform scale-100 opacity-100"
                                leaveTo="transform scale-95 opacity-0"
                              >
                                <Listbox.Options>
                                  <div className="bg-zinc-300 dark:bg-zinc-800 p-2 rounded-md shadow-2xl">
                                    {envOptions.map((env: Partial<EnvironmentType>) => (
                                      <Listbox.Option key={env.id} value={env} as={Fragment}>
                                        {({ active, selected }) => (
                                          <div
                                            className={clsx(
                                              'flex items-center gap-2 p-1 cursor-pointer',
                                              active && 'font-semibold'
                                            )}
                                          >
                                            {selected ? (
                                              <FaCheckSquare className="text-emerald-500" />
                                            ) : (
                                              <FaSquare />
                                            )}
                                            {env.name}
                                          </div>
                                        )}
                                      </Listbox.Option>
                                    ))}
                                  </div>
                                </Listbox.Options>
                              </Transition>
                            </>
                          )}
                        </Listbox>
                      </div>
                      <div className="flex items-center gap-4">
                        <Button variant="secondary" type="button" onClick={closeModal}>
                          Cancel
                        </Button>
                        <Button variant="primary" onClick={handleCreateNewServiceToken}>
                          Create
                        </Button>
                      </div>
                    </div>
                  )}
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}

export const SecretTokens = (props: { organisationId: string; appId: string }) => {
  const { organisationId, appId } = props

  const { keyring } = useContext(KeyringContext)

  const [getUserTokens, { data: userTokensData }] = useLazyQuery(GetUserTokens)
  const [getServiceTokens, { data: serviceTokensData }] = useLazyQuery(GetServiceTokens)

  const [deleteUserToken] = useMutation(RevokeUserToken)
  const [deleteServiceToken] = useMutation(RevokeServiceToken)

  const [createServiceToken] = useMutation(CreateNewServiceToken)

  const [serviceToken, setServiceToken] = useState<string>('')

  const handleDeleteUserToken = async (tokenId: string) => {
    await deleteUserToken({
      variables: { tokenId },
      refetchQueries: [
        {
          query: GetUserTokens,
          variables: {
            organisationId,
          },
        },
      ],
    })
  }

  const handleDeleteServiceToken = async (tokenId: string) => {
    await deleteServiceToken({
      variables: { tokenId },
      refetchQueries: [
        {
          query: GetServiceTokens,
          variables: {
            organisationId,
            appId,
          },
        },
      ],
    })
  }

  useEffect(() => {
    if (organisationId && appId) {
      getUserTokens({
        variables: {
          organisationId,
        },
      })
      getServiceTokens({
        variables: {
          appId,
        },
      })
    }
  }, [appId, getServiceTokens, getUserTokens, organisationId])

  const DeleteConfirmDialog = (props: {
    token: UserTokenType | ServiceTokenType
    onDelete: Function
  }) => {
    const { token, onDelete } = props

    const [isOpen, setIsOpen] = useState<boolean>(false)

    const closeModal = () => {
      setIsOpen(false)
    }

    const openModal = () => {
      setIsOpen(true)
    }

    return (
      <>
        <div className="flex items-center justify-center">
          <Button variant="danger" onClick={openModal} title="Delete secret">
            <div className="text-white dark:text-red-500 flex items-center gap-1 p-1">
              <FaTrashAlt />
            </div>
          </Button>
        </div>

        <Transition appear show={isOpen} as={Fragment}>
          <Dialog as="div" className="relative z-10" onClose={closeModal}>
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0"
              enterTo="opacity-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <div className="fixed inset-0 bg-black/25 backdrop-blur-md" />
            </Transition.Child>

            <div className="fixed inset-0 overflow-y-auto">
              <div className="flex min-h-full items-center justify-center p-4 text-center">
                <Transition.Child
                  as={Fragment}
                  enter="ease-out duration-300"
                  enterFrom="opacity-0 scale-95"
                  enterTo="opacity-100 scale-100"
                  leave="ease-in duration-200"
                  leaveFrom="opacity-100 scale-100"
                  leaveTo="opacity-0 scale-95"
                >
                  <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                    <Dialog.Title as="div" className="flex w-full justify-between">
                      <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                        Delete{' '}
                        <span className="text-zinc-700 dark:text-zinc-200 font-mono">
                          {token.name}
                        </span>
                      </h3>

                      <Button variant="text" onClick={closeModal}>
                        <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>

                    <div className="space-y-6 p-4">
                      <p className="text-neutral-500">
                        Are you sure you want to delete this token?
                      </p>
                      <div className="flex items-center gap-4">
                        <Button variant="secondary" type="button" onClick={closeModal}>
                          Cancel
                        </Button>
                        <Button variant="danger" onClick={() => onDelete(token.id)}>
                          Delete
                        </Button>
                      </div>
                    </div>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>
      </>
    )
  }

  const UserToken = (props: { token: UserTokenType }) => {
    const { token } = props

    return (
      <div className="flex items-center w-full justify-between p-2">
        <div className="flex items-center gap-4">
          <FaUserLock className="text-sky-500/30 text-lg" />
          <div className="space-y-0">
            <div className="text-lg font-medium">{token.name}</div>
            <div className="text-base text-neutral-500">
              Created {relativeTimeFromDates(new Date(token.createdAt))}
            </div>
          </div>
        </div>
        <DeleteConfirmDialog token={token} onDelete={handleDeleteUserToken} />
      </div>
    )
  }

  const ServiceToken = (props: { token: ServiceTokenType }) => {
    const { token } = props

    return (
      <div className="flex items-center w-full justify-between p-2">
        <div className="flex items-center gap-4">
          <FaKey className="text-purple-500/30 text-lg" />
          <div className="space-y-0">
            <div className="text-lg font-medium">{token.name}</div>
            <div className="text-base text-neutral-500">
              Created {relativeTimeFromDates(new Date(token.createdAt))}
            </div>
          </div>
        </div>
        <DeleteConfirmDialog token={token} onDelete={handleDeleteServiceToken} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <h3 className="text-2xl font-semibold border-neutral-500/40">User tokens</h3>
          <p className="text-neutral-500">
            Tokens used to authenticate with the CLI from personal devices. Used for development and
            manual configuration.
          </p>
        </div>
        <div className="space-y-2 divide-y divide-neutral-500">
          {userTokensData?.userTokens.map((userToken: UserTokenType) => (
            <UserToken key={userToken.id} token={userToken} />
          ))}
        </div>

        <CreateUserTokenDialog organisationId={organisationId} />
      </div>

      <hr className="border border-neutral-500/40" />

      <div className="space-y-4">
        <div>
          <h3 className="text-2xl font-semibold border-neutral-500/40">Service tokens</h3>
          <p className="text-neutral-500">
            Tokens used to authenticate with the CLI from automated machines. Used for CI and
            production environments.
          </p>
        </div>
        <div className="space-y-2 divide-y divide-neutral-500">
          {serviceTokensData?.serviceTokens.map((serviceToken: ServiceTokenType) => (
            <ServiceToken key={serviceToken.id} token={serviceToken} />
          ))}
        </div>

        <CreateServiceTokenDialog organisationId={organisationId} appId={appId} />
      </div>
    </div>
  )
}
