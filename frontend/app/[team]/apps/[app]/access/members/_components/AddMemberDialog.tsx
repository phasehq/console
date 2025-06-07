import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import { BulkAddMembersToApp } from '@/graphql/mutations/apps/bulkAddAppMembers.gql'
import GetAppMembers from '@/graphql/queries/apps/getAppMembers.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { OrganisationMemberType, EnvironmentType, MemberType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { Listbox, Menu, Transition } from '@headlessui/react'
import {
  FaArrowRight,
  FaBan,
  FaCheckCircle,
  FaChevronDown,
  FaCircle,
  FaPlus,
  FaSearch,
  FaTimesCircle,
  FaTrashAlt,
} from 'react-icons/fa'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { Avatar } from '@/components/common/Avatar'
import { Alert } from '@/components/common/Alert'
import Link from 'next/link'
import { unwrapEnvSecretsForUser, wrapEnvSecretsForAccount } from '@/utils/crypto'
import GenericDialog from '@/components/common/GenericDialog'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasPermission } from '@/utils/access/permissions'
import { KeyringContext } from '@/contexts/keyringContext'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'
import { MdSearchOff } from 'react-icons/md'
import { RoleLabel } from '@/components/users/RoleLabel'

type MemberWithEnvScope = OrganisationMemberType & {
  scope: Partial<EnvironmentType>[]
}

export const AddMemberDialog = ({ appId }: { appId: string }) => {
  const { keyring } = useContext(KeyringContext)
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const dialogRef = useRef<{ closeModal: () => void }>(null)

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

  const { data: orgMembersData } = useQuery(GetOrganisationMembers, {
    variables: {
      organisationId: organisation?.id,
      role: null,
    },
    skip: !organisation || !userCanAddAppMembers,
  })

  const { data, loading } = useQuery(GetAppMembers, {
    variables: { appId: appId },
    skip: !userCanReadAppMembers,
  })

  const [getEnvKey] = useLazyQuery(GetEnvironmentKey)

  const [selectedMembers, setSelectedMembers] = useState<MemberWithEnvScope[]>([])

  const memberOptions = useMemo(() => {
    return (
      orgMembersData?.organisationMembers
        .filter(
          (orgMember: OrganisationMemberType) =>
            !data?.appUsers.some((appUser: OrganisationMemberType) => appUser.id === orgMember.id)
        )
        .map((member: OrganisationMemberType) => ({
          ...member,
          scope: [],
        }))
        .filter((m: MemberWithEnvScope) => !selectedMembers.map((sm) => sm.id).includes(m.id)) ?? []
    )
  }, [orgMembersData, data, selectedMembers])

  const [bulkAddMembers] = useMutation(BulkAddMembersToApp)

  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId: appId,
    },
    skip: !userCanReadEnvironments,
  })

  const envOptions: Partial<EnvironmentType>[] =
    appEnvsData?.appEnvironments.map((env: EnvironmentType) => {
      const { id, name } = env

      return {
        id,
        name,
      }
    }) ?? []

  const membersWithoutScope = selectedMembers.some((member) => member.scope.length === 0)

  const reset = () => {
    setSelectedMembers([])
  }
  const closeModal = () => dialogRef.current?.closeModal()

  const handleClose = () => {
    closeModal()
    reset()
  }

  const handleAddMembers = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (membersWithoutScope) {
      toast.error('Please select an Environment scope for all members')
      return false
    }

    const appEnvironments = appEnvsData.appEnvironments as EnvironmentType[]

    const envKeyInputs: {
      envId: string
      userId: string
      identityKey: string
      wrappedSeed: string
      wrappedSalt: string
    }[] = []

    for (const env of appEnvironments) {
      for (const member of selectedMembers) {
        const selectedEnvIds = member.scope.map((env) => env.id!) ?? []
        if (!selectedEnvIds.includes(env.id)) continue

        const { data } = await getEnvKey({
          variables: {
            envId: env.id,
            appId: appId,
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

        const { wrappedSeed, wrappedSalt } = await wrapEnvSecretsForAccount({ seed, salt }, member)

        envKeyInputs.push({
          envId: env.id,
          userId: member.id,
          identityKey,
          wrappedSeed,
          wrappedSalt,
        })
      }
    }

    await bulkAddMembers({
      variables: {
        members: selectedMembers.map((member) => ({
          memberId: member.id,
          memberType: MemberType.User,

          envKeys: envKeyInputs.filter((k) => k.userId === member.id),
        })),
        appId,
      },
      refetchQueries: [
        {
          query: GetAppMembers,
          variables: { appId: appId },
        },
      ],
    })

    toast.success('Added accounts to App', { autoClose: 2000 })
    handleClose()
  }

  const SelectMemberMenu = () => {
    const [query, setQuery] = useState('')

    const buttonRef = useRef<HTMLButtonElement>(null)

    useEffect(() => {
      if (buttonRef.current && selectedMembers.length === 0) buttonRef.current.click()
    }, [buttonRef])

    const filteredPeople =
      query === ''
        ? memberOptions
        : memberOptions.filter((member: OrganisationMemberType) => {
            const memberQueryableName = `${member.fullName} ${member.email}`
            return memberQueryableName.toLowerCase().includes(query.toLowerCase())
          })

    return (
      <Menu as="div" className="relative inline-block text-left group w-96">
        {({ open }) => (
          <>
            <Menu.Button as={Fragment}>
              <Button variant={open ? 'secondary' : 'ghost'} ref={buttonRef}>
                <FaPlus className="mr-1" />{' '}
                {selectedMembers.length ? 'Add another member' : 'Select a Member'}
              </Button>
            </Menu.Button>
            <Transition
              as={Fragment}
              enter="transition duration-100 ease-out"
              enterFrom="transform scale-95 opacity-0"
              enterTo="transform scale-100 opacity-100"
              leave="transition duration-75 ease-out"
              leaveFrom="transform scale-100 opacity-100"
              leaveTo="transform scale-95 opacity-0"
            >
              <Menu.Items className="absolute z-10 left-0 origin-top-right mt-2 divide-y divide-neutral-500/40 p-px rounded-md shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none">
                <div className="relative flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md px-2 w-full text-sm">
                  <FaSearch className="text-neutral-500" />

                  <input
                    placeholder="Search Members"
                    className="custom bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <FaTimesCircle
                    className={clsx(
                      'cursor-pointer text-neutral-500 transition-opacity ease absolute right-2',
                      query ? 'opacity-100' : 'opacity-0'
                    )}
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      setQuery('')
                    }}
                  />
                </div>

                <div className="max-h-96 overflow-y-auto divide-y divide-neutral-500/20 bg-neutral-200/40 dark:bg-neutral-800/40 backdrop-blur rounded-b-md w-full max-w-screen-lg">
                  {loading ? (
                    <div className="p-4">
                      <Spinner size="sm" />
                    </div>
                  ) : filteredPeople.length > 0 ? (
                    filteredPeople.map((member: MemberWithEnvScope) => (
                      <Menu.Item key={member.id}>
                        {({ active }) => (
                          <div
                            className={clsx(
                              'flex items-center justify-between gap-2 p-2 text-sm cursor-pointer transition ease w-full min-w-96',
                              active ? 'bg-neutral-100 dark:bg-neutral-800' : ''
                            )}
                            onClick={() => setSelectedMembers([...selectedMembers, member])}
                          >
                            <div className="flex items-center gap-2">
                              <Avatar member={member} size="md" />
                              <div>
                                <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                                  {member.fullName || member.email}
                                </div>
                                {member.fullName && (
                                  <div className="text-neutral-500 text-xs leading-4">
                                    {member.email}
                                  </div>
                                )}
                              </div>
                            </div>
                            <RoleLabel role={member.role!} />
                          </div>
                        )}
                      </Menu.Item>
                    ))
                  ) : query ? (
                    <div className="p-4 w-full max-w-screen-lg">
                      <EmptyState
                        title={`No results for "${query}"`}
                        subtitle="Try adjusting your search term"
                        graphic={
                          <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                            <MdSearchOff />
                          </div>
                        }
                      >
                        <></>
                      </EmptyState>
                    </div>
                  ) : (
                    <div className="p-4 text-center text-neutral-500 text-sm w-64">
                      All org members are already added to this app
                    </div>
                  )}
                </div>
              </Menu.Items>
            </Transition>
          </>
        )}
      </Menu>
    )
  }

  return (
    <>
      <GenericDialog
        ref={dialogRef}
        title="Add members"
        size="lg"
        buttonContent={
          <>
            <FaPlus /> Add members
          </>
        }
      >
        {memberOptions.length === 0 && selectedMembers.length === 0 ? (
          <div className="py-4">
            <Alert variant="info" icon={true}>
              <div className="flex flex-col gap-2">
                <p>
                  All organisation members are added to this App. You can invite more users from the
                  organisation members page.
                </p>
                <Link href={`/${organisation?.name}/access/members`}>
                  <Button variant="secondary">
                    Go to Members <FaArrowRight />
                  </Button>
                </Link>
              </div>
            </Alert>
          </div>
        ) : (
          <form className="space-y-6" onSubmit={handleAddMembers}>
            <p className="text-neutral-500 text-sm">
              Select members to add to this App, and choose the Environments that they will be able
              to access.
            </p>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div className="w-1/2 text-2xs font-medium text-gray-500 uppercase tracking-wider">
                  Member
                </div>
                <div className="w-1/2 text-2xs font-medium text-gray-500 uppercase tracking-wider">
                  Environment scope <span className="text-red-500">*</span>
                </div>
                <div className="w-9"></div>
              </div>
              {selectedMembers.map((member, index) => (
                <div key={member.id} className="space-y-1 flex items-center justify-between gap-2">
                  <div
                    className={clsx('flex items-center justify-between gap-2 p-1 text-sm w-1/2')}
                  >
                    <div className="flex items-center gap-2">
                      <Avatar member={member} size="md" />
                      <div>
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {member.fullName || member.email}
                        </div>
                        {member.fullName && (
                          <div className="text-neutral-500 text-xs leading-4">{member.email}</div>
                        )}
                      </div>
                    </div>
                    <RoleLabel role={member.role!} />
                  </div>
                  <div className="w-1/2">
                    {userCanReadEnvironments ? (
                      <Listbox
                        multiple
                        by="id"
                        value={member.scope ?? []}
                        onChange={(newScopes) =>
                          setSelectedMembers((prev) =>
                            prev.map((m) => (m.id === member.id ? { ...m, scope: newScopes } : m))
                          )
                        }
                      >
                        {({ open }) => (
                          <div className="relative">
                            <Listbox.Button
                              className={clsx(
                                'p-2 flex items-center justify-between bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40  cursor-pointer min-h-10 text-sm text-left w-full',
                                open ? 'rounded-t-md' : 'rounded-md',
                                member.scope?.length
                                  ? 'text-zinc-900 dark:text-zinc-100'
                                  : 'text-zinc-500'
                              )}
                            >
                              {member.scope?.length
                                ? envOptions
                                    .filter((env) =>
                                      member.scope
                                        .map((selectedEnv) => selectedEnv.id)
                                        .includes(env.id!)
                                    )
                                    .map((env) => env.name)
                                    .join(' + ')
                                : 'Select environment scope'}
                              <FaChevronDown
                                className={clsx(
                                  'transform transition ease text-neutral-500',
                                  open ? '-rotate-180' : 'rotate-0'
                                )}
                              />
                            </Listbox.Button>
                            <Transition
                              as={Fragment}
                              leave="transition ease-in duration-100"
                              leaveFrom="opacity-100"
                              leaveTo="opacity-0"
                            >
                              <Listbox.Options className="bg-neutral-200 dark:bg-neutral-800 p-2 rounded-b-md ring-1 ring-inset ring-neutral-500/40 shadow-2xl absolute -my-px z-10 w-full divide-y divide-neutral-500/20">
                                {envOptions.map((env) => (
                                  <Listbox.Option key={`${member.id}-${env.id}`} value={env}>
                                    {({ active, selected }) => (
                                      <div
                                        className={clsx(
                                          'flex items-center gap-2 p-1 cursor-pointer text-sm rounded-md transition ease text-zinc-900 dark:text-zinc-100',
                                          active ? ' bg-neutral-100 dark:bg-neutral-700' : ''
                                        )}
                                      >
                                        {selected ? (
                                          <FaCheckCircle className="text-emerald-500" />
                                        ) : (
                                          <FaCircle className="text-neutral-500" />
                                        )}
                                        <span
                                          className={clsx(
                                            'block truncate',
                                            selected ? 'font-medium' : 'font-normal'
                                          )}
                                        >
                                          {env.name}
                                        </span>
                                      </div>
                                    )}
                                  </Listbox.Option>
                                ))}
                              </Listbox.Options>
                            </Transition>
                          </div>
                        )}
                      </Listbox>
                    ) : (
                      <div className="flex items-center text-neutral-500 gap-2 text-sm">
                        <FaBan /> Access restricted
                      </div>
                    )}
                  </div>

                  <div className="">
                    <Button
                      variant="danger"
                      title="Remove this member"
                      onClick={() =>
                        setSelectedMembers(selectedMembers.filter((m) => m.id !== member.id))
                      }
                    >
                      <div className="py-1">
                        <FaTrashAlt className="shrink-0" />
                      </div>
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex w-full">
              <SelectMemberMenu />
            </div>

            <div className="flex items-center justify-between gap-4">
              <Button variant="secondary" type="button" onClick={handleClose}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={!selectedMembers.length}>
                <FaPlus /> Add{' '}
                {selectedMembers.length > 0
                  ? ` ${selectedMembers.length} ${selectedMembers.length === 1 ? 'member' : 'members'} `
                  : ''}
              </Button>
            </div>
          </form>
        )}
      </GenericDialog>
    </>
  )
}
