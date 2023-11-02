'use client'

import { CreateNewUserToken } from '@/graphql/mutations/users/createUserToken.gql'
import { RevokeUserToken } from '@/graphql/mutations/users/deleteUserToken.gql'
import { GetUserTokens } from '@/graphql/queries/users/getUserTokens.gql'
import { generateUserToken } from '@/utils/environments'
import { ServiceTokenType, UserTokenType } from '@/apollo/graphql'
import { getUserKxPublicKey, getUserKxPrivateKey } from '@/utils/crypto'
import { useLazyQuery, useMutation } from '@apollo/client'
import { useState, useEffect, useContext, Fragment } from 'react'
import { KeyringContext } from '@/contexts/keyringContext'
import { Button } from '@/components/common/Button'
import {
  FaCircle,
  FaDotCircle,
  FaExclamationTriangle,
  FaKey,
  FaPlus,
  FaTimes,
  FaTrashAlt,
} from 'react-icons/fa'
import { getUnixTimeStampinFuture, relativeTimeFromDates } from '@/utils/time'
import { Dialog, RadioGroup, Transition } from '@headlessui/react'
import { copyToClipBoard } from '@/utils/clipboard'
import { MdContentCopy } from 'react-icons/md'
import { toast } from 'react-toastify'
import clsx from 'clsx'
import { organisationContext } from '@/contexts/organisationContext'
import UnlockKeyringDialog from '@/components/auth/UnlockKeyringDialog'

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

const CreateUserTokenDialog = (props: { organisationId: string }) => {
  const { organisationId } = props

  const { keyring } = useContext(KeyringContext)

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [name, setName] = useState<string>('')
  const [expiry, setExpiry] = useState<ExpiryOptionT>(tokenExpiryOptions[0])

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

  const handleCreateNewUserToken = async (event: { preventDefault: () => void }) => {
    event.preventDefault()

    if (name.length === 0) {
      toast.error('You must enter a name for the token')
      return false
    }

    if (keyring) {
      const userKxKeys = {
        publicKey: await getUserKxPublicKey(keyring.publicKey),
        privateKey: await getUserKxPrivateKey(keyring.privateKey),
      }

      const { pssUser, mutationPayload } = await generateUserToken(
        organisationId,
        userKxKeys,
        name,
        expiry.getExpiry()
      )

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
                        <code className="text-xs break-all text-blue-500 ph-no-capture">
                          {userToken}
                        </code>
                      </div>
                    </div>
                  ) : (
                    <form className="space-y-6 p-4" onSubmit={handleCreateNewUserToken}>
                      <div className="space-y-2 w-full">
                        <label
                          className="block text-gray-700 text-sm font-bold mb-2"
                          htmlFor="name"
                        >
                          Token name
                        </label>
                        <input
                          required
                          id="name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                        />
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
                        <Button variant="secondary" type="button" onClick={closeModal}>
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

export default function Tokens({ params }: { params: { team: string } }) {
  const [getUserTokens, { data: userTokensData }] = useLazyQuery(GetUserTokens)

  const [deleteUserToken] = useMutation(RevokeUserToken)

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const organisationId = organisation?.id

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

  useEffect(() => {
    if (organisationId) {
      getUserTokens({
        variables: {
          organisationId,
        },
      })
    }
  }, [getUserTokens, organisationId])

  const userTokens =
    [...(userTokensData?.userTokens || [])].sort((a: UserTokenType, b: UserTokenType) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    }) || []

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

  const CreatedToken = (props: {
    token: ServiceTokenType | UserTokenType
    deleteHandler: Function
  }) => {
    const { token, deleteHandler } = props

    const isExpired = token.expiresAt === null ? false : new Date(token.expiresAt) < new Date()

    return (
      <tr className="group">
        <td className="flex items-center gap-4 p-2">
          <FaKey className="text-teal-500/50 text-lg" />
          <div className="space-y-0">
            <div className="text-lg font-medium">{token.name}</div>
            <div className="flex items-center gap-8 text-sm text-neutral-500">
              <div className="flex items-center gap-2">
                <div>Created {relativeTimeFromDates(new Date(token.createdAt))}</div>
              </div>
            </div>
          </div>
        </td>

        <td className={clsx('p-2', isExpired && 'text-red-500')}>
          {isExpired ? 'Expired' : 'Expires'}{' '}
          {token.expiresAt ? relativeTimeFromDates(new Date(token.expiresAt)) : 'never'}
        </td>

        <td className="opacity-0 group-hover:opacity-100 transition-opacity ease p-2 justify-end flex">
          <DeleteConfirmDialog token={token} onDelete={deleteHandler} />
        </td>
      </tr>
    )
  }

  return (
    <section className="h-screen overflow-y-auto">
      {organisation && <UnlockKeyringDialog organisationId={organisation.id} />}
      <div className="w-full space-y-8 p-8 text-black dark:text-white">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">User tokens</h1>
          <p className="text-neutral-500">
            Tokens used to authenticate with the CLI from personal devices. Used for development and
            manual configuration.
          </p>
        </div>
        <div className="space-y-6 pb-6 divide-y-2 divide-neutral-500/40">
          <div className="space-y-4">
            <div className="flex justify-end py-4">
              <CreateUserTokenDialog organisationId={organisationId!} />
            </div>
            <table className="table-auto min-w-full divide-y divide-zinc-500/40">
              <thead>
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    token
                  </th>

                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    expiry
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-500/40">
                {userTokens.map((userToken: UserTokenType) => (
                  <CreatedToken
                    key={userToken.id}
                    token={userToken}
                    deleteHandler={handleDeleteUserToken}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  )
}
