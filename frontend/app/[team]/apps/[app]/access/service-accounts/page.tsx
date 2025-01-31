'use client'

import { GetServiceAccounts } from '@/graphql/queries/service-accounts/getServiceAccounts.gql'
import AddMemberToApp from '@/graphql/mutations/apps/addAppMember.gql'
import RemoveMemberFromApp from '@/graphql/mutations/apps/removeAppMember.gql'
import UpdateEnvScope from '@/graphql/mutations/apps/updateEnvScope.gql'
import { GetAppServiceAccounts } from '@/graphql/queries/apps/getAppServiceAccounts.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useMemo, useState } from 'react'
import { EnvironmentType, ServiceAccountType, MemberType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { Combobox, Dialog, Listbox, Transition } from '@headlessui/react'
import {
  FaArrowRight,
  FaBan,
  FaCheckSquare,
  FaChevronDown,
  FaCog,
  FaKey,
  FaPlus,
  FaRobot,
  FaSquare,
  FaTimes,
  FaTrash,
} from 'react-icons/fa'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { useSession } from 'next-auth/react'
import { KeyringContext } from '@/contexts/keyringContext'
import { userHasGlobalAccess, userHasPermission } from '@/utils/access/permissions'
import { RoleLabel } from '@/components/users/RoleLabel'
import { Alert } from '@/components/common/Alert'
import Link from 'next/link'
import { unwrapEnvSecretsForUser, wrapEnvSecretsForAccount } from '@/utils/crypto'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'

export default function ServiceAccounts({ params }: { params: { team: string; app: string } }) {
  const { keyring } = useContext(KeyringContext)
  const { activeOrganisation: organisation } = useContext(organisationContext)

  // Permissions
  const userCanReadAppSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'read', true)
    : false
  const userCanReadEnvironments = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Environments', 'read', true)
    : false

  // AppServiceAccounts:create + ServiceAccounts: read
  const userCanAddAppSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'create', true) &&
      userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'read')
    : false
  const userCanRemoveAppSA = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'delete', true)
    : false
  // AppMembers:update + Environments:read
  const userCanUpdateSAAccess = organisation
    ? userHasPermission(organisation?.role?.permissions, 'ServiceAccounts', 'update', true) &&
      userHasPermission(organisation?.role?.permissions, 'Environments', 'read', true)
    : false

  const { data, loading } = useQuery(GetAppServiceAccounts, {
    variables: { appId: params.app },
    skip: !userCanReadAppSA,
  })

  const [getEnvKey] = useLazyQuery(GetEnvironmentKey)

  const { data: session } = useSession()

  const AddAccountDialog = () => {
    const { data: serviceAccountsData } = useQuery(GetServiceAccounts, {
      variables: {
        orgId: organisation?.id,
      },
      skip: !organisation || !userCanAddAppSA,
    })

    const accountOptions =
      serviceAccountsData?.serviceAccounts.filter(
        (account: ServiceAccountType) =>
          !data?.appServiceAccounts
            .map((account: ServiceAccountType) => account.id)
            .includes(account.id)
      ) ?? []

    const [addMember] = useMutation(AddMemberToApp)

    const { data: appEnvsData } = useQuery(GetAppEnvironments, {
      variables: {
        appId: params.app,
      },
      skip: !userCanReadEnvironments,
    })

    const envOptions =
      appEnvsData?.appEnvironments.map((env: EnvironmentType) => {
        const { id, name } = env

        return {
          id,
          name,
        }
      }) ?? []

    const [isOpen, setIsOpen] = useState<boolean>(false)
    const [selectedAccount, setSelectedAccount] = useState<ServiceAccountType | null>(null)
    const [query, setQuery] = useState('')
    const [envScope, setEnvScope] = useState<Array<Record<string, string>>>([])
    const [showEnvHint, setShowEnvHint] = useState<boolean>(false)

    const filteredAccounts =
      query === ''
        ? accountOptions
        : accountOptions.filter((account: ServiceAccountType) => {
            return account.name.toLowerCase().includes(query.toLowerCase())
          })

    const closeModal = () => {
      setIsOpen(false)
    }

    const openModal = () => {
      setIsOpen(true)
    }

    const handleAddMember = async (e: { preventDefault: () => void }) => {
      e.preventDefault()

      if (envScope.length === 0) {
        setShowEnvHint(true)
        return false
      }

      const appEnvironments = appEnvsData.appEnvironments as EnvironmentType[]

      const envKeyPromises = appEnvironments
        .filter((env) => envScope.map((selectedEnv) => selectedEnv.id).includes(env.id))
        .map(async (env: EnvironmentType) => {
          const { data } = await getEnvKey({
            variables: {
              envId: env.id,
              appId: params.app,
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

          console.log('unwrapped env secrets', seed, salt)

          const { wrappedSeed, wrappedSalt } = await wrapEnvSecretsForAccount(
            { seed, salt },
            selectedAccount!
          )

          return {
            envId: env.id,
            userId: selectedAccount!.id,
            identityKey,
            wrappedSeed,
            wrappedSalt,
          }
        })

      const envKeyInputs = await Promise.all(envKeyPromises)

      await addMember({
        variables: {
          memberId: selectedAccount!.id,
          memberType: MemberType.Service,
          appId: params.app,
          envKeys: envKeyInputs,
        },
        refetchQueries: [
          {
            query: GetAppServiceAccounts,
            variables: { appId: params.app },
          },
        ],
      })

      toast.success('Added account to App', { autoClose: 2000 })
    }

    return (
      <>
        <div className="flex items-center justify-center">
          <Button variant="primary" onClick={openModal} title="Add a member">
            <FaPlus /> Add service account
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
                  <Dialog.Panel className="w-full max-w-2xl transform rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                    <Dialog.Title as="div" className="flex w-full justify-between">
                      <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                        Add service account
                      </h3>

                      <Button variant="text" onClick={closeModal}>
                        <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>

                    {accountOptions.length === 0 ? (
                      <div className="py-4">
                        <Alert variant="info" icon={true}>
                          <div className="flex flex-col gap-2">
                            <p>
                              All organisation service accounts are added to this App. You can
                              create more service accounts from the organisation access page.
                            </p>
                            <Link href={`/${params.team}/access/service-accounts`}>
                              <Button variant="secondary">
                                Go to Service Accounts <FaArrowRight />
                              </Button>
                            </Link>
                          </div>
                        </Alert>
                      </div>
                    ) : (
                      <form className="space-y-6 p-4" onSubmit={handleAddMember}>
                        <Combobox value={selectedAccount} onChange={setSelectedAccount}>
                          {({ open }) => (
                            <>
                              <div className="space-y-1">
                                <Combobox.Label as={Fragment}>
                                  <label
                                    className="block text-gray-700 text-sm font-bold"
                                    htmlFor="name"
                                  >
                                    Service Account
                                  </label>
                                </Combobox.Label>
                                <div className="w-full relative flex items-center">
                                  <Combobox.Input
                                    className="w-full"
                                    onChange={(event) => setQuery(event.target.value)}
                                    required
                                    displayValue={(account: ServiceAccountType) =>
                                      account ? account.name : 'Select an account'
                                    }
                                  />
                                  <div className="absolute inset-y-0 right-2 flex items-center">
                                    <Combobox.Button>
                                      <FaChevronDown
                                        className={clsx(
                                          'text-neutral-500 transform transition ease cursor-pointer',
                                          open ? 'rotate-180' : 'rotate-0'
                                        )}
                                      />
                                    </Combobox.Button>
                                  </div>
                                </div>
                              </div>
                              <Transition
                                enter="transition duration-100 ease-out"
                                enterFrom="transform scale-95 opacity-0"
                                enterTo="transform scale-100 opacity-100"
                                leave="transition duration-75 ease-out"
                                leaveFrom="transform scale-100 opacity-100"
                                leaveTo="transform scale-95 opacity-0"
                              >
                                <Combobox.Options as={Fragment}>
                                  <div className="bg-zinc-300 dark:bg-zinc-800 p-2 rounded-md shadow-2xl z-20">
                                    {filteredAccounts.map((account: ServiceAccountType) => (
                                      <Combobox.Option key={account.id} value={account}>
                                        {({ active, selected }) => (
                                          <div
                                            className={clsx(
                                              'flex items-center gap-2 p-1 cursor-pointer',
                                              active && 'font-semibold'
                                            )}
                                          >
                                            <div className="rounded-full flex items-center bg-neutral-500/40 justify-center size-8">
                                              <FaRobot className="shrink-0 text-zinc-900 dark:text-zinc-100 grow" />
                                            </div>
                                            <span className="text-black dark:text-white">
                                              {account.name}
                                            </span>
                                          </div>
                                        )}
                                      </Combobox.Option>
                                    ))}
                                  </div>
                                </Combobox.Options>
                              </Transition>
                            </>
                          )}
                        </Combobox>

                        {userCanReadEnvironments ? (
                          <div className="space-y-1 w-full relative pb-8">
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
                                    <div className="p-2 flex items-center justify-between bg-zinc-100 dark:bg-zinc-800 border border-neutral-500/40 rounded-md cursor-pointer h-10">
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
                                      <div className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded-md border border-neutral-500/40 shadow-2xl absolute z-10 w-full">
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
                        ) : (
                          <Alert variant="danger" icon={true} size="sm">
                            You don&apos;t have permission to read Environments. This permission is
                            required to set an environment scope for users in this App.
                          </Alert>
                        )}

                        <div className="flex items-center gap-4">
                          <Button variant="secondary" type="button" onClick={closeModal}>
                            Cancel
                          </Button>
                          <Button
                            variant="primary"
                            type="submit"
                            disabled={envScope.length === 0 || selectedAccount === null}
                          >
                            Add
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

  const RemoveAccountConfirmDialog = (props: { account: ServiceAccountType }) => {
    const { account } = props

    const [removeMember] = useMutation(RemoveMemberFromApp)

    const [isOpen, setIsOpen] = useState<boolean>(false)

    const closeModal = () => {
      setIsOpen(false)
    }

    const openModal = () => {
      setIsOpen(true)
    }

    const handleRemoveMember = async () => {
      await removeMember({
        variables: { memberId: account.id, memberType: MemberType.Service, appId: params.app },
        refetchQueries: [
          {
            query: GetAppServiceAccounts,
            variables: { appId: params.app },
          },
        ],
      })
      toast.success('Removed member from app', { autoClose: 2000 })
    }

    return (
      <>
        <div className="flex items-center justify-center">
          <Button variant="danger" onClick={openModal} title="Remove account">
            <FaTrash /> Remove Account
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
                        Remove member
                      </h3>

                      <Button variant="text" onClick={closeModal}>
                        <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>

                    <div className="space-y-6 p-4">
                      <p className="text-neutral-500">
                        Are you sure you want to remove {account.name} from this app?
                      </p>
                      <div className="flex items-center gap-4">
                        <Button variant="secondary" type="button" onClick={closeModal}>
                          Cancel
                        </Button>
                        <Button variant="danger" onClick={handleRemoveMember}>
                          Remove
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

  const ManageAccountAccessDialog = ({ account }: { account: ServiceAccountType }) => {
    const [updateScope] = useMutation(UpdateEnvScope)

    // Get environments that the active user has access to
    const { data: appEnvsData } = useQuery(GetAppEnvironments, {
      variables: {
        appId: params.app,
      },
    })

    // Get the environemnts that the account has access to
    const { data: userEnvScopeData } = useQuery(GetAppEnvironments, {
      variables: {
        appId: params.app,
        memberId: account.id,
        memberType: MemberType.Service,
      },
    })

    const envScope: Array<Record<string, string>> = useMemo(() => {
      return (
        userEnvScopeData?.appEnvironments.map((env: EnvironmentType) => ({
          id: env.id,
          name: env.name,
        })) ?? []
      )
    }, [userEnvScopeData])

    const envOptions =
      appEnvsData?.appEnvironments.map((env: EnvironmentType) => {
        const { id, name } = env

        return {
          id,
          name,
        }
      }) ?? []

    const [isOpen, setIsOpen] = useState<boolean>(false)

    const [scope, setScope] = useState<Array<Record<string, string>>>([])
    const [showEnvHint, setShowEnvHint] = useState<boolean>(false)

    const memberHasGlobalAccess = (account: ServiceAccountType) =>
      userHasGlobalAccess(account.role?.permissions)

    const closeModal = () => {
      setIsOpen(false)
    }

    const openModal = () => {
      setIsOpen(true)
    }

    useEffect(() => {
      setScope(envScope)
    }, [envScope])

    const handleUpdateScope = async (e: { preventDefault: () => void }) => {
      e.preventDefault()

      if (scope.length === 0) {
        setShowEnvHint(true)
        return false
      }

      const appEnvironments = appEnvsData.appEnvironments as EnvironmentType[]

      const envKeyPromises = appEnvironments
        .filter((env) => scope.map((selectedEnv) => selectedEnv.id).includes(env.id))
        .map(async (env: EnvironmentType) => {
          const { data } = await getEnvKey({
            variables: {
              envId: env.id,
              appId: params.app,
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

          const { wrappedSeed, wrappedSalt } = await wrapEnvSecretsForAccount(
            { seed, salt },
            account!
          )

          return {
            envId: env.id,
            userId: account!.id,
            identityKey,
            wrappedSeed,
            wrappedSalt,
          }
        })

      const envKeyInputs = await Promise.all(envKeyPromises)

      await updateScope({
        variables: {
          memberId: account!.id,
          memberType: MemberType.Service,
          appId: params.app,
          envKeys: envKeyInputs,
        },
        refetchQueries: [
          {
            query: GetAppEnvironments,
            variables: {
              appId: params.app,
              memberId: account.id,
              memberType: MemberType.Service,
            },
          },
        ],
      })

      toast.success('Updated account access', { autoClose: 2000 })
    }

    const allowUpdateScope = userCanUpdateSAAccess

    return (
      <>
        <div className="flex items-center gap-2">
          <span className="text-zinc-900 dark:text-zinc-100 text-sm font-medium">
            {envScope.map((env) => env.name).join(' + ')}
          </span>
          {allowUpdateScope && (
            <div className="opacity-0 group-hover:opacity-100 transition ease">
              <Button variant="outline" onClick={openModal} title="Manage access">
                <FaCog /> Manage
              </Button>
            </div>
          )}
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
                  <Dialog.Panel className="w-full max-w-2xl transform rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                    <Dialog.Title as="div" className="flex w-full justify-between">
                      <div>
                        <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                          Manage access for {account.name}
                        </h3>
                        <p className="text-neutral-500">
                          Manage the environment scope for this service account
                        </p>
                      </div>

                      <Button variant="text" onClick={closeModal}>
                        <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>

                    <form className="space-y-6 pt-4" onSubmit={handleUpdateScope}>
                      {memberHasGlobalAccess(account) && (
                        <Alert variant="info" icon={true} size="sm">
                          <p>
                            This user&apos;s role grants them access to all environments in this
                            App. To restrict their access, change their role from the{' '}
                            <Link
                              className="font-semibold hover:underline"
                              href={`/${params.team}/access/members`}
                            >
                              organisation members
                            </Link>{' '}
                            page.
                          </p>
                        </Alert>
                      )}

                      <div className="divide-y divide-neutral-500/20">
                        <div className="space-y-1 w-full relative pb-4">
                          {scope.length === 0 && showEnvHint && (
                            <span className="absolute right-2 inset-y-0 text-red-500 text-xs">
                              Select an environment scope
                            </span>
                          )}
                          <Listbox
                            value={scope}
                            by="id"
                            onChange={setScope}
                            multiple
                            name="environments"
                            disabled={memberHasGlobalAccess(account)}
                          >
                            {({ open }) => (
                              <>
                                <Listbox.Label as={Fragment}>
                                  <label
                                    className="block text-neutral-500 text-sm mb-2"
                                    htmlFor="name"
                                  >
                                    Environment scope
                                  </label>
                                </Listbox.Label>
                                <Listbox.Button as={Fragment} aria-required>
                                  <div
                                    className={clsx(
                                      'p-2 flex items-center justify-between bg-zinc-100 dark:bg-zinc-800 border border-neutral-500/40 rounded-md h-10',
                                      memberHasGlobalAccess(account)
                                        ? 'cursor-not-allowed'
                                        : 'cursor-pointer'
                                    )}
                                  >
                                    <span className="text-black dark:text-white">
                                      {scope
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
                                    <div className="bg-zinc-100 dark:bg-zinc-800 border border-neutral-500/40 p-2 rounded-md shadow-2xl absolute z-10 w-full">
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

                        <div className="flex items-end gap-4 justify-between py-2">
                          <div>
                            <label className="block text-neutral-500 text-sm mb-2" htmlFor="name">
                              Account Tokens
                            </label>
                            <div className="text-zinc-900 dark:text-zinc-100 font-medium">
                              {account.tokens?.length! > 0 ? account.tokens?.length! : 'No'} active
                              tokens
                            </div>
                          </div>
                          <Link href={`/${params.team}/access/service-accounts/${account.id}`}>
                            <Button
                              variant="outline"
                              title="Manage this service account, or get a token"
                            >
                              <FaCog /> Manage Tokens
                            </Button>
                          </Link>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-4">
                        <Button variant="secondary" type="button" onClick={closeModal}>
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          type="submit"
                          disabled={memberHasGlobalAccess(account)}
                        >
                          Save
                        </Button>
                      </div>
                    </form>
                  </Dialog.Panel>
                </Transition.Child>
              </div>
            </div>
          </Dialog>
        </Transition>
      </>
    )
  }

  if (!organisation || loading)
    return (
      <div className="h-full max-h-screen overflow-y-auto w-full flex items-center justify-center">
        <Spinner size="md" />
      </div>
    )

  return (
    <div className="w-full space-y-6 text-black dark:text-white">
      <div className="px-4">
        <h2 className="text-xl font-bold">Service Accounts</h2>
        <div className="text-neutral-500">Manage access for service accounts to this App</div>
      </div>
      {userCanReadAppSA ? (
        <div className="space-y-4">
          {userCanAddAppSA && data?.appServiceAccounts.length > 0 && (
            <div className="flex justify-end">
              <AddAccountDialog />
            </div>
          )}

          {data?.appServiceAccounts.length === 0 ? (
            <EmptyState
              title="No accounts added"
              subtitle="No Service Accounts have been added to this App yet. Add an account below."
              graphic={
                <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                  <FaRobot />
                </div>
              }
            >
              <>
                <AddAccountDialog />
              </>
            </EmptyState>
          ) : (
            <table className="table-auto min-w-full divide-y divide-zinc-500/40">
              <thead>
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Account
                  </th>

                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Environment Access
                  </th>
                  {userCanRemoveAppSA && <th className="px-6 py-3"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-500/20">
                {data?.appServiceAccounts.map((account: ServiceAccountType) => (
                  <tr className="group" key={account.id}>
                    <td className="px-6 py-4 whitespace-nowrap flex items-center gap-2">
                      <div className="rounded-full flex items-center bg-neutral-500/20 justify-center size-12">
                        <FaRobot className="shrink-0 text-zinc-900 dark:text-zinc-100 grow" />
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-medium">{account.name}</span>
                          <RoleLabel role={account.role!} />
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 ">
                        <ManageAccountAccessDialog account={account} />
                      </div>
                    </td>

                    {userCanRemoveAppSA && (
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition ease">
                          <RemoveAccountConfirmDialog account={account} />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <EmptyState
          title="Access restricted"
          subtitle="You don't have the permissions required to view Members in this app."
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
  )
}
