'use client'

import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import AddMemberToApp from '@/graphql/mutations/apps/addAppMember.gql'
import RemoveMemberFromApp from '@/graphql/mutations/apps/removeAppMember.gql'
import UpdateEnvScope from '@/graphql/mutations/apps/updateEnvScope.gql'
import GetAppMembers from '@/graphql/queries/apps/getAppMembers.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useState } from 'react'
import { OrganisationMemberType, EnvironmentType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { relativeTimeFromDates } from '@/utils/time'
import { Combobox, Dialog, Listbox, Transition } from '@headlessui/react'
import {
  FaCheckSquare,
  FaChevronDown,
  FaEye,
  FaEyeSlash,
  FaPlus,
  FaSquare,
  FaTimes,
  FaUserCog,
  FaUserTimes,
} from 'react-icons/fa'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { useSession } from 'next-auth/react'
import { Avatar } from '@/components/common/Avatar'
import { KeyringContext } from '@/contexts/keyringContext'
import { userIsAdmin } from '@/utils/permissions'
import { RoleLabel } from '@/components/users/RoleLabel'
import { Alert } from '@/components/common/Alert'
import Link from 'next/link'
import { unwrapEnvSecretsForUser, wrapEnvSecretsForUser } from '@/utils/crypto'

export default function Members({ params }: { params: { team: string; app: string } }) {
  const { data } = useQuery(GetAppMembers, { variables: { appId: params.app } })

  const { keyring } = useContext(KeyringContext)
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const activeUserIsAdmin = organisation ? userIsAdmin(organisation.role!) : false

  const [getEnvKey] = useLazyQuery(GetEnvironmentKey)

  const { data: session } = useSession()

  const AddMemberDialog = () => {
    const { data: orgMembersData } = useQuery(GetOrganisationMembers, {
      variables: {
        organisationId: organisation?.id,
        role: null,
      },
      skip: !organisation,
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

          const { wrappedSeed, wrappedSalt } = await wrapEnvSecretsForUser(
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
                  <Dialog.Panel className="w-full max-w-2xl transform overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
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
                          <p>
                            All organisation members are added to this App. You can invite more
                            users from the{' '}
                            <Link
                              className="font-semibold hover:underline"
                              href={`/${params.team}/members`}
                            >
                              organisation members
                            </Link>{' '}
                            page.
                          </p>
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
                                      person?.fullName || person?.email!
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
                                            <Avatar imagePath={person.avatarUrl!} size="sm" />
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

                        <div className="flex items-center gap-4">
                          <Button variant="secondary" type="button" onClick={closeModal}>
                            Cancel
                          </Button>
                          <Button variant="primary" type="submit">
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
            <div className="text-white dark:text-red-500 flex items-center gap-1">
              <FaUserTimes /> Remove user
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

  const ManageUserAccessDialog = (props: { member: OrganisationMemberType }) => {
    const [updateScope] = useMutation(UpdateEnvScope)
    const [getUserEnvScope] = useLazyQuery(GetAppEnvironments)

    const { data: appEnvsData } = useQuery(GetAppEnvironments, {
      variables: {
        appId: params.app,
      },
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

    const [envScope, setEnvScope] = useState<Array<Record<string, string>>>([])
    const [showEnvHint, setShowEnvHint] = useState<boolean>(false)

    const memberIsAdmin = userIsAdmin(props.member.role) || false

    const closeModal = () => {
      setIsOpen(false)
    }

    const openModal = () => {
      setIsOpen(true)
    }

    useEffect(() => {
      if (isOpen) {
        const handleGetCurrentSCope = async () => {
          const { data: currentScope } = await getUserEnvScope({
            variables: {
              appId: params.app,
              memberId: props.member.id,
            },
            fetchPolicy: 'no-cache',
          })

          setEnvScope(
            currentScope?.appEnvironments.map((env: EnvironmentType) => {
              const { id, name } = env

              return {
                id,
                name,
              }
            }) ?? []
          )
        }

        if (isOpen) handleGetCurrentSCope()
      }
    }, [getUserEnvScope, isOpen, props.member.id])

    const handleUpdateScope = async (e: { preventDefault: () => void }) => {
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

          const { wrappedSeed, wrappedSalt } = await wrapEnvSecretsForUser(
            { seed, salt },
            props.member!
          )

          return {
            envId: env.id,
            userId: props.member!.id,
            identityKey,
            wrappedSeed,
            wrappedSalt,
          }
        })

      const envKeyInputs = await Promise.all(envKeyPromises)

      await updateScope({
        variables: { memberId: props.member!.id, appId: params.app, envKeys: envKeyInputs },
        refetchQueries: [
          {
            query: GetAppMembers,
            variables: { appId: params.app },
          },
        ],
      })

      toast.success('Updated user access', { autoClose: 2000 })
    }

    return (
      <>
        <div className="flex items-center justify-center">
          <Button variant="outline" onClick={openModal} title="Manage access">
            <FaUserCog /> Manage user access
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
                        Manage access for {props.member.fullName || props.member.email}
                      </h3>

                      <Button variant="text" onClick={closeModal}>
                        <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>

                    <form
                      className={clsx('space-y-6 p-4', memberIsAdmin && 'opacity-60')}
                      onSubmit={handleUpdateScope}
                    >
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
                          disabled={memberIsAdmin}
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
                                    memberIsAdmin ? 'cursor-not-allowed' : 'cursor-pointer'
                                  )}
                                >
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

                      {memberIsAdmin && (
                        <Alert variant="info" icon={true}>
                          <p>
                            This user is an <RoleLabel role="admin" />, and has access to all
                            environments in this App. To restrict their access, change their role to{' '}
                            <RoleLabel role="dev" /> from the{' '}
                            <Link
                              className="font-semibold hover:underline"
                              href={`/${params.team}/members`}
                            >
                              organisation members
                            </Link>{' '}
                            page.
                          </p>
                        </Alert>
                      )}

                      <div className="flex items-center gap-4">
                        <Button variant="secondary" type="button" onClick={closeModal}>
                          Cancel
                        </Button>
                        <Button variant="primary" type="submit" disabled={memberIsAdmin}>
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

  return (
    <div className="w-full space-y-10 pt-8 text-black dark:text-white">
      <div className="space-y-4">
        <div className="flex justify-end">
          <AddMemberDialog />
        </div>

        <table className="table-auto min-w-full divide-y divide-zinc-500/40">
          <thead>
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                User
              </th>

              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Joined
              </th>
              {activeUserIsAdmin && <th className="px-6 py-3"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-500/40">
            {data?.appUsers.map((member: OrganisationMemberType) => (
              <tr className="group" key={member.id}>
                <td className="px-6 py-4 whitespace-nowrap flex items-center gap-2">
                  <Avatar imagePath={member.avatarUrl!} size="lg" />
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-medium">{member.fullName || member.email}</span>
                      <RoleLabel role={member.role} />
                    </div>
                    {member.fullName && (
                      <span className="text-neutral-500 text-sm">{member.email}</span>
                    )}
                  </div>
                </td>

                <td className="px-6 py-4 whitespace-nowrap capitalize">
                  {relativeTimeFromDates(new Date(member.createdAt))}
                </td>
                {activeUserIsAdmin && (
                  <td className="px-6 py-4">
                    {member.email !== session?.user?.email &&
                      member.role.toLowerCase() !== 'owner' && (
                        <div className="flex items-center justify-end gap-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition ease">
                          <ManageUserAccessDialog member={member} />
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
    </div>
  )
}
