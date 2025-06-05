import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import { BulkAddMembersToApp } from '@/graphql/mutations/apps/bulkAddAppMembers.gql'
import GetAppMembers from '@/graphql/queries/apps/getAppMembers.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useMemo, useRef, useState } from 'react'
import { OrganisationMemberType, EnvironmentType, MemberType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { Listbox, Menu, Transition } from '@headlessui/react'
import {
  FaArrowRight,
  FaBan,
  FaCheckCircle,
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

type MemberWithEnvScope = OrganisationMemberType & {
  scope: Partial<EnvironmentType>[]
}

const dummyUsers: Partial<MemberWithEnvScope>[] = [
  {
    id: '6a0f5746-e4c0-4e45-8d9e-1cfe1d3a1b5a',
    email: 'kelly.morrison@example.com',
    fullName: 'Kelly Morrison',
    scope: [],
  },
  {
    id: 'b7b3c121-5054-4d7a-b35b-f327dadc5417',
    email: 'edward.jackson@example.net',
    fullName: 'Edward Jackson',
    scope: [],
  },
  {
    id: '2d7e3a56-8bc0-4e16-9a4e-c8c3ebc0e75d',
    email: 'lucy.barnes@example.org',
    fullName: 'Lucy Barnes',
    scope: [],
  },
  {
    id: 'f9b4a1ea-3c74-4c9f-b9d9-45d5e9b7e61b',
    email: 'michael.williams@example.com',
    fullName: 'Michael Williams',
    scope: [],
  },
  {
    id: '9a071a44-821a-4c13-b9b8-c68a58aeb3f4',
    email: 'sophia.moore@example.net',
    fullName: 'Sophia Moore',
    scope: [],
  },
  {
    id: '7c5f6c3b-9f2d-40e6-b10a-8df0c00c5fdb',
    email: 'daniel.taylor@example.com',
    fullName: 'Daniel Taylor',
    scope: [],
  },
  {
    id: 'd4a1c7b7-5e09-411d-b8e9-1d04eeec7d02',
    email: 'amelia.white@example.org',
    fullName: 'Amelia White',
    scope: [],
  },
  {
    id: '15e0bb28-85b7-4e19-9d63-ef1ee02b2aa7',
    email: 'james.anderson@example.com',
    fullName: 'James Anderson',
    scope: [],
  },
  {
    id: '4097d341-4778-4adf-a00f-97d0d3c98462',
    email: 'olivia.jones@example.net',
    fullName: 'Olivia Jones',
    scope: [],
  },
  {
    id: '93f3454d-11fa-48a7-b345-374a4177f58b',
    email: 'benjamin.harris@example.org',
    fullName: 'Benjamin Harris',
    scope: [],
  },
  {
    id: 'b9185b72-7ac1-4f09-8a8b-45349a10b875',
    email: 'charlotte.martin@example.com',
    fullName: 'Charlotte Martin',
    scope: [],
  },
  {
    id: 'a1c1a2b9-4ea8-456a-b69a-2d6edfe6c1e9',
    email: 'liam.thomas@example.net',
    fullName: 'Liam Thomas',
    scope: [],
  },
  {
    id: '3b17679f-1f71-4a36-9eec-3f65d7bda56f',
    email: 'isabella.lewis@example.org',
    fullName: 'Isabella Lewis',
    scope: [],
  },
  {
    id: 'c592db4f-1f31-4d0e-9b9e-6b16aaaf4f4a',
    email: 'noah.robinson@example.com',
    fullName: 'Noah Robinson',
    scope: [],
  },
  {
    id: 'd6e30b47-8d14-4b32-b597-57d6d3c12bde',
    email: 'mia.walker@example.net',
    fullName: 'Mia Walker',
    scope: [],
  },
  {
    id: '1d6e5f83-5c3a-434d-b0d6-11db9e50c331',
    email: 'ethan.young@example.org',
    fullName: 'Ethan Young',
    scope: [],
  },
  {
    id: '5a5e1a6e-413d-42e4-bb7e-2a235ca7515a',
    email: 'amelia.king@example.com',
    fullName: 'Amelia King',
    scope: [],
  },
  {
    id: 'f5d8f839-05ac-4a48-9a1b-285ade84e825',
    email: 'jack.carter@example.net',
    fullName: 'Jack Carter',
    scope: [],
  },
  {
    id: '8d5d84e3-2613-44a5-9c8a-56f9de135eab',
    email: 'emily.mitchell@example.org',
    fullName: 'Emily Mitchell',
    scope: [],
  },
  {
    id: '44e7e433-8056-4b67-9437-8577c2f44f6e',
    email: 'oliver.scott@example.com',
    fullName: 'Oliver Scott',
    scope: [],
  },
]

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
        .concat(dummyUsers)
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

    const filteredPeople =
      query === ''
        ? memberOptions
        : memberOptions.filter((member: OrganisationMemberType) => {
            const memberQueryableName = `${member.fullName} ${member.email}`
            return memberQueryableName.toLowerCase().includes(query.toLowerCase())
          })

    return (
      <Menu as="div" className="relative inline-block text-left group w-96">
        <Menu.Button as={Fragment}>
          <Button variant="ghost">
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
                className="custom bg-zinc-100 dark:bg-zinc-800"
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
                          'flex items-center gap-2 p-2 text-sm cursor-pointer transition ease w-full min-w-96',
                          active ? 'bg-neutral-100 dark:bg-neutral-800' : ''
                        )}
                        onClick={() => setSelectedMembers([...selectedMembers, member])}
                      >
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
              <div className="flex items-center gap-2 justify-between">
                <div className="w-1/2 text-2xs font-medium text-gray-500 uppercase tracking-wider">
                  Member
                </div>
                <div className="w-1/2 text-2xs font-medium text-gray-500 uppercase tracking-wider">
                  Environment scope
                </div>
                <div className="w-9"></div>
              </div>
              {selectedMembers.map((member, index) => (
                <div key={member.id} className="space-y-1 flex items-center justify-between gap-2">
                  <div className={clsx('flex items-center gap-2 p-1 text-sm w-1/2')}>
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
                                    .join(', ')
                                : 'Select environment scope'}
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
              <Button
                variant="primary"
                type="submit"
                disabled={membersWithoutScope || !selectedMembers.length}
              >
                Add{' '}
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
