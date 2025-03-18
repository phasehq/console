'use client'

import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import AddMemberToApp from '@/graphql/mutations/apps/addAppMember.gql'
import RemoveMemberFromApp from '@/graphql/mutations/apps/removeAppMember.gql'
import UpdateEnvScope from '@/graphql/mutations/apps/updateEnvScope.gql'
import GetAppMembers from '@/graphql/queries/apps/getAppMembers.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useMemo, useState } from 'react'
import { OrganisationMemberType, EnvironmentType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { Combobox, Dialog, Listbox, Transition } from '@headlessui/react'
import {
  FaArrowRight,
  FaBan,
  FaCheckSquare,
  FaChevronDown,
  FaCog,
  FaPlus,
  FaSquare,
  FaTimes,
  FaUserTimes,
} from 'react-icons/fa'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { useSession } from 'next-auth/react'
import { Avatar } from '@/components/common/Avatar'
import { KeyringContext } from '@/contexts/keyringContext'
import { userHasGlobalAccess, userHasPermission } from '@/utils/access/permissions'
import { RoleLabel } from '@/components/users/RoleLabel'
import { Alert } from '@/components/common/Alert'
import Link from 'next/link'
import { unwrapEnvSecretsForUser, wrapEnvSecretsForAccount } from '@/utils/crypto'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'

export default function Members({ params }: { params: { team: string; app: string } }) {
  const { keyring } = useContext(KeyringContext)
  const { activeOrganisation: organisation } = useContext(organisationContext)

  // Permissions
  const userCanReadAppMembers = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Members', 'read', true)
    : false
  const userCanReadEnvironments = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Environments', 'read', true)
    : false

  // AppMembers:create + OrgMembers: read
  const userCanAddAppMembers = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Members', 'create', true) &&
      userHasPermission(organisation?.role?.permissions, 'Members', 'read')
    : false
  const userCanRemoveAppMembers = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Members', 'delete', true)
    : false
  // AppMembers:update + Environments:read
  const userCanUpdateMemberAccess = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Members', 'update', true) &&
      userHasPermission(organisation?.role?.permissions, 'Environments', 'read', true)
    : false

  const { data, loading } = useQuery(GetAppMembers, {
    variables: { appId: params.app },
    skip: !userCanReadAppMembers,
  })

  const [getEnvKey] = useLazyQuery(GetEnvironmentKey)

  const { data: session } = useSession()

  const AddMemberDialog = () => {
    const { data: orgMembersData } = useQuery(GetOrganisationMembers, {
      variables: {
        organisationId: organisation?.id,
        role: null,
      },
      skip: !organisation || !userCanAddAppMembers,
    })

    const memberOptions =
      orgMembersData?.organisationMembers.filter(
        (orgMember: OrganisationMemberType) =>
          !data?.appUsers
            .map((appUser: OrganisationMemberType) => appUser.id)
            .includes(orgMember.id)
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
    const [selectedMember, setSelectedMember] = useState<OrganisationMemberType | null>(null)
    const [query, setQuery] = useState('')
    const [envScope, setEnvScope] = useState<Array<Record<string, string>>>([])
    const [showEnvHint, setShowEnvHint] = useState<boolean>(false)

    const filteredPeople =
      query === ''
        ? memberOptions
        : memberOptions.filter((member: OrganisationMemberType) => {
            const memberQueryableName = member.fullName || member.email!
            return memberQueryableName.toLowerCase().includes(query.toLowerCase())
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

          const { wrappedSeed, wrappedSalt } = await wrapEnvSecretsForAccount(
            { seed, salt },
            selectedMember!
          )

          return {
            envId: env.id,
            userId: selectedMember!.id,
            identityKey,
            wrappedSeed,
            wrappedSalt,
          }
        })

      const envKeyInputs = await Promise.all(envKeyPromises)

      await addMember({
        variables: { memberId: selectedMember!.id, appId: params.app, envKeys: envKeyInputs },
        refetchQueries: [
          {
            query: GetAppMembers,
            variables: { appId: params.app },
          },
        ],
      })

      toast.success('Added member to App', { autoClose: 2000 })
    }

    return (
      <>
        <div className="flex items-center justify-center">
          <Button variant="primary" onClick={openModal} title="Add a member">
            <FaPlus /> Add a member
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
                        Add a member
                      </h3>

                      <Button variant="text" onClick={closeModal}>
                        <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>

                    {memberOptions.length === 0 ? (
                      <div className="py-4">
                        <Alert variant="info" icon={true}>
                          <div className="flex flex-col gap-2">
                            <p>
                              All organisation members are added to this App. You can invite more
                              users from the organisation members page.
                            </p>
                            <Link href={`/${params.team}/access/members`}>
                              <Button variant="secondary">
                                Go to Members <FaArrowRight />
                              </Button>
                            </Link>
                          </div>
                        </Alert>
                      </div>
                    ) : (
                      <form className="space-y-6 p-4" onSubmit={handleAddMember}>
                        <Combobox value={selectedMember} onChange={setSelectedMember}>
                          {({ open }) => (
                            <>
                              <div className="space-y-1">
                                <Combobox.Label as={Fragment}>
                                  <label
                                    className="block text-gray-700 text-sm font-bold"
                                    htmlFor="name"
                                  >
                                    User
                                  </label>
                                </Combobox.Label>
                                <div className="w-full relative flex items-center">
                                  <Combobox.Input
                                    className="w-full"
                                    onChange={(event) => setQuery(event.target.value)}
                                    required
                                    displayValue={(person: OrganisationMemberType) =>
                                      person ? person?.fullName || person?.email! : 'Select a user'
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
                                    {filteredPeople.map((person: OrganisationMemberType) => (
                                      <Combobox.Option key={person.id} value={person}>
                                        {({ active, selected }) => (
                                          <div
                                            className={clsx(
                                              'flex items-center gap-2 p-1 cursor-pointer',
                                              active && 'font-semibold'
                                            )}
                                          >
                                            <Avatar member={person} size="sm" />
                                            <span className="text-black dark:text-white">
                                              {person.fullName || person.email}
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
                            disabled={envScope.length === 0 || selectedMember === null}
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

  const RemoveMemberConfirmDialog = (props: { member: OrganisationMemberType }) => {
    const { member } = props

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
        variables: { memberId: member.id, appId: params.app },
        refetchQueries: [
          {
            query: GetAppMembers,
            variables: { appId: params.app },
          },
        ],
      })
      toast.success('Removed member from app', { autoClose: 2000 })
    }

    return (
      <>
        <div className="flex items-center justify-center">
          <Button variant="danger" onClick={openModal} title="Remove member">
            <FaUserTimes /> Remove user
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
                        Are you sure you want to remove {member.fullName || member.email} from this
                        app?
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

  const ManageUserAccessDialog = ({ member }: { member: OrganisationMemberType }) => {
    const [updateScope] = useMutation(UpdateEnvScope)

    // Get environments that the active user has access to
    const { data: appEnvsData } = useQuery(GetAppEnvironments, {
      variables: {
        appId: params.app,
      },
    })

    // Get the environemnts that the member has access to
    const { data: userEnvScopeData } = useQuery(GetAppEnvironments, {
      variables: {
        appId: params.app,
        memberId: member.id,
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

    const memberHasGlobalAccess = (user: OrganisationMemberType) =>
      userHasGlobalAccess(user.role?.permissions)

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
            member!
          )

          return {
            envId: env.id,
            userId: member!.id,
            identityKey,
            wrappedSeed,
            wrappedSalt,
          }
        })

      const envKeyInputs = await Promise.all(envKeyPromises)

      await updateScope({
        variables: { memberId: member!.id, appId: params.app, envKeys: envKeyInputs },
        refetchQueries: [
          {
            query: GetAppEnvironments,
            variables: {
              appId: params.app,
              memberId: member.id,
            },
          },
        ],
      })

      toast.success('Updated user access', { autoClose: 2000 })
    }

    const allowUpdateScope =
      member.email !== session?.user?.email &&
      member.role!.name!.toLowerCase() !== 'owner' &&
      userCanUpdateMemberAccess

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
                      <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                        Manage access for {member.fullName || member.email}
                      </h3>

                      <Button variant="text" onClick={closeModal}>
                        <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>

                    <form className="space-y-6 py-4" onSubmit={handleUpdateScope}>
                      {memberHasGlobalAccess(member) && (
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

                      <div className="space-y-1 w-full relative">
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
                          disabled={memberHasGlobalAccess(member)}
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
                                <div
                                  className={clsx(
                                    'p-2 flex items-center justify-between bg-zinc-100 dark:bg-zinc-800 border border-neutral-500/40 rounded-md h-10',
                                    memberHasGlobalAccess(member)
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

                      <div className="flex items-center gap-4">
                        <Button variant="secondary" type="button" onClick={closeModal}>
                          Cancel
                        </Button>
                        <Button
                          variant="primary"
                          type="submit"
                          disabled={memberHasGlobalAccess(member)}
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
        <h2 className="text-xl font-bold">Members</h2>
        <div className="text-neutral-500">Manage access for human users to this App</div>
      </div>
      {userCanReadAppMembers ? (
        <div className="space-y-4">
          {userCanAddAppMembers && (
            <div className="flex justify-end">
              <AddMemberDialog />
            </div>
          )}

          <table className="table-auto min-w-full divide-y divide-zinc-500/40">
            <thead>
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User
                </th>

                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Environment Access
                </th>
                {userCanRemoveAppMembers && <th className="px-6 py-3"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-500/20">
              {data?.appUsers.map((member: OrganisationMemberType) => (
                <tr className="group" key={member.id}>
                  <td className="px-6 py-4 whitespace-nowrap flex items-center gap-2">
                    <Avatar member={member} size="lg" />
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-lg font-medium">
                          {member.fullName || member.email}
                        </span>
                        <RoleLabel role={member.role!} />
                      </div>
                      {member.fullName && (
                        <span className="text-neutral-500 text-sm">{member.email}</span>
                      )}
                    </div>
                  </td>

                  <td className="px-6 py-4">
                    <ManageUserAccessDialog member={member} />
                  </td>

                  {userCanRemoveAppMembers && (
                    <td className="px-6 py-4">
                      {member.email !== session?.user?.email &&
                        member.role!.name!.toLowerCase() !== 'owner' && (
                          <div className="flex items-center justify-end gap-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition ease">
                            <RemoveMemberConfirmDialog member={member} />
                          </div>
                        )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
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
