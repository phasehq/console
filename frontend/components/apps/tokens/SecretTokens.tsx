import { RevokeServiceToken } from '@/graphql/mutations/environments/deleteServiceToken.gql'
import { CreateNewServiceToken } from '@/graphql/mutations/environments/createServiceToken.gql'
import { GetServiceTokens } from '@/graphql/queries/secrets/getServiceTokens.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import {
  newEnvToken,
  newEnvWrapKey,
  newServiceTokenKeys,
  unwrapEnvSecretsForUser,
  wrapEnvSecretsForServiceToken,
} from '@/utils/environments'
import { EnvironmentType, ServiceTokenType, UserTokenType } from '@/apollo/graphql'
import { cryptoUtils } from '@/utils/auth'
import { splitSecret } from '@/utils/keyshares'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { useState, useEffect, useContext, Fragment } from 'react'
import { KeyringContext } from '@/contexts/keyringContext'
import { Button } from '@/components/common/Button'
import {
  FaCheckSquare,
  FaChevronDown,
  FaCircle,
  FaDotCircle,
  FaExclamationTriangle,
  FaKey,
  FaPlus,
  FaSquare,
  FaTimes,
  FaTrashAlt,
} from 'react-icons/fa'
import { getUnixTimeStampinFuture, relativeTimeFromDates } from '@/utils/time'
import { Dialog, Listbox, RadioGroup, Transition } from '@headlessui/react'
import { copyToClipBoard } from '@/utils/clipboard'
import { MdContentCopy } from 'react-icons/md'
import { toast } from 'react-toastify'
import clsx from 'clsx'
import { organisationContext } from '@/contexts/organisationContext'
import { userIsAdmin } from '@/utils/permissions'
import { Avatar } from '@/components/common/Avatar'

interface ExpiryOptionT {
  name: string
  getExpiry: () => number | null
}

const handleCopy = (val: string) => {
  copyToClipBoard(val)
  toast.info('Copied', {
    autoClose: 2000,
  })
}

const tokenExpiryOptions: ExpiryOptionT[] = [
  {
    name: 'Never',
    getExpiry: () => null,
  },
  {
    name: '7 days',
    getExpiry: () => getUnixTimeStampinFuture(7),
  },
  {
    name: '30 days',
    getExpiry: () => getUnixTimeStampinFuture(30),
  },
  {
    name: '60 days',
    getExpiry: () => getUnixTimeStampinFuture(60),
  },
  {
    name: '90 days',
    getExpiry: () => getUnixTimeStampinFuture(90),
  },
]

const compareExpiryOptions = (a: ExpiryOptionT, b: ExpiryOptionT) => {
  return a.getExpiry() === b.getExpiry()
}

const humanReadableExpiry = (expiryOption: ExpiryOptionT) =>
  expiryOption.getExpiry() === null
    ? 'This token will never expire.'
    : `This token will expire on ${new Date(expiryOption.getExpiry()!).toLocaleDateString()}.`

const CreateServiceTokenDialog = (props: { organisationId: string; appId: string }) => {
  const { organisationId, appId } = props

  const { keyring } = useContext(KeyringContext)

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [name, setName] = useState<string>('')
  const [envScope, setEnvScope] = useState<Array<Record<string, string>>>([])
  const [expiry, setExpiry] = useState<ExpiryOptionT>(tokenExpiryOptions[0])
  const [showEnvHint, setShowEnvHint] = useState<boolean>(false)

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
    setShowEnvHint(false)
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

  const handleCreateNewServiceToken = async (event: { preventDefault: () => void }) => {
    event.preventDefault()

    if (envScope.length === 0) {
      setShowEnvHint(true)
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
          expiry: expiry.getExpiry(),
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
        <Button variant="primary" onClick={openModal} title="Create Service Token">
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
                      <div className="bg-teal-200 dark:bg-teal-400/10 shadow-inner p-3 rounded-lg">
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
                        <code className="text-xs break-all text-teal-500">{serviceToken}</code>
                      </div>
                    </div>
                  ) : (
                    <form className="space-y-6 p-4" onSubmit={handleCreateNewServiceToken}>
                      <div className="space-y-1 w-full">
                        <label
                          className="block text-gray-700 text-sm font-bold mb-2"
                          htmlFor="name"
                        >
                          Token name
                        </label>
                        <input
                          id="name"
                          required
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </div>

                      <div className="space-y-1 w-full relative">
                        {envScope.length === 0 && showEnvHint && (
                          <span className="absolute right-2 inset-y-0 text-red-500 text-xs">
                            Select an environment scope
                          </span>
                        )}
                        <Listbox
                          value={envScope}
                          by="id"
                          onChange={setEnvScope}
                          multiple
                          name="environments"
                          horizontal
                        >
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
                              <Listbox.Button as={Fragment} aria-required>
                                <div className="p-2 flex items-center justify-between bg-zinc-100 dark:bg-zinc-800 rounded-md border border-neutral-500/40 cursor-pointer h-10">
                                  <span className="text-black dark:text-white">
                                    {envScope
                                      .map((env: Partial<EnvironmentType>) => env.name)
                                      .join(' + ')}
                                  </span>
                                  <FaChevronDown
                                    className={clsx(
                                      'transition-transform ease duration-300 text-neutral-500',
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
                                  <div className="bg-zinc-100 dark:bg-zinc-800 p-2 flex flex-wrap gap-2 rounded-md border border-neutral-500/40 shadow-2xl absolute z-10 w-full">
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
                                              <FaSquare className="text-neutral-500" />
                                            )}
                                            <span className="text-black dark:text-white">
                                              {env.name}
                                            </span>
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

                      <div>
                        <RadioGroup value={expiry} by={compareExpiryOptions} onChange={setExpiry}>
                          <RadioGroup.Label as={Fragment}>
                            <label className="block text-gray-700 text-sm font-bold mb-2">
                              Expiry
                            </label>
                          </RadioGroup.Label>
                          <div className="flex flex-wrap items-center gap-2">
                            {tokenExpiryOptions.map((option) => (
                              <RadioGroup.Option key={option.name} value={option} as={Fragment}>
                                {({ active, checked }) => (
                                  <div
                                    className={clsx(
                                      'flex items-center gap-2 py-1 px-2 cursor-pointer bg-zinc-800 border border-zinc-800  rounded-full',
                                      active && 'border-zinc-700',
                                      checked && 'bg-zinc-700'
                                    )}
                                  >
                                    {checked ? (
                                      <FaDotCircle className="text-emerald-500" />
                                    ) : (
                                      <FaCircle />
                                    )}
                                    {option.name}
                                  </div>
                                )}
                              </RadioGroup.Option>
                            ))}
                          </div>
                        </RadioGroup>
                        <span className="text-sm text-neutral-500">
                          {humanReadableExpiry(expiry)}
                        </span>
                      </div>

                      <div className="flex items-center gap-4">
                        <Button variant="secondary" onClick={closeModal}>
                          Cancel
                        </Button>
                        <Button variant="primary" type="submit">
                          Create
                        </Button>
                      </div>
                    </form>
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

  const [getServiceTokens, { data: serviceTokensData }] = useLazyQuery(GetServiceTokens)

  const [deleteServiceToken] = useMutation(RevokeServiceToken)

  const { activeOrganisation: organisation } = useContext(organisationContext)

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
      getServiceTokens({
        variables: {
          appId,
        },
      })
    }
  }, [appId, getServiceTokens, organisationId])

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
          <Button variant="danger" onClick={openModal} title="Delete Token">
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

  const CreatedToken = (props: { token: ServiceTokenType; deleteHandler: Function }) => {
    const { token, deleteHandler } = props

    const isExpired = token.expiresAt === null ? false : new Date(token.expiresAt) < new Date()

    const activeUserIsAdmin = organisation ? userIsAdmin(organisation.role!) : false

    const allowDelete = activeUserIsAdmin || token.createdBy!.self

    return (
      <div className="flex items-center w-full justify-between p-2 group">
        <div className="flex items-center gap-4">
          <FaKey className="text-teal-500/50 text-lg" />
          <div className="space-y-0">
            <div className="text-lg font-medium">{token.name}</div>
            <div className="flex items-center gap-8 text-sm text-neutral-500">
              <div className="flex items-center gap-2">
                <div>Created {relativeTimeFromDates(new Date(token.createdAt))}</div>
                {token.__typename === 'ServiceTokenType' && (
                  <div className="flex items-center gap-2">
                    <span>by</span>
                    <Avatar imagePath={token.createdBy?.avatarUrl!} size="sm" />
                    {token.createdBy?.self
                      ? 'You'
                      : token.createdBy?.fullName || token.createdBy?.email}
                  </div>
                )}
              </div>

              <div className={clsx(isExpired && 'text-red-500')}>
                {isExpired ? 'Expired' : 'Expires'}{' '}
                {token.expiresAt ? relativeTimeFromDates(new Date(token.expiresAt)) : 'never'}
              </div>
            </div>
          </div>
        </div>
        {allowDelete && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity ease">
            <DeleteConfirmDialog token={token} onDelete={deleteHandler} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-6 divide-y-2 divide-neutral-500/40">
      <div className="space-y-4 py-4">
        <div>
          <h3 className="text-2xl font-semibold border-neutral-500/40">Service tokens</h3>
          <p className="text-neutral-500">
            Tokens used to authenticate with the CLI from automated machines. Used for CI and
            production environments.
          </p>
        </div>
        <div className="space-y-2 divide-y divide-neutral-500/50">
          {serviceTokensData?.serviceTokens.map((serviceToken: ServiceTokenType) => (
            <CreatedToken
              key={serviceToken.id}
              token={serviceToken}
              deleteHandler={handleDeleteServiceToken}
            />
          ))}
        </div>

        <CreateServiceTokenDialog organisationId={organisationId} appId={appId} />
      </div>
    </div>
  )
}
