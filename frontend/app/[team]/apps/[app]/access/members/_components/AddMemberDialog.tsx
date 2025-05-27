import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import { BulkAddMembersToApp } from '@/graphql/mutations/apps/bulkAddAppMembers.gql'
import GetAppMembers from '@/graphql/queries/apps/getAppMembers.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useRef, useState } from 'react'
import { OrganisationMemberType, EnvironmentType, MemberType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { Combobox, Listbox, Transition } from '@headlessui/react'
import {
  FaArrowRight,
  FaAsterisk,
  FaCheckCircle,
  FaChevronDown,
  FaCircle,
  FaPlus,
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

export const AddMemberDialog = ({ appId }: { appId: string }) => {
  const { keyring } = useContext(KeyringContext)
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const dialogRef = useRef<{ closeModal: () => void }>(null)
  const comboboxButtonRef = useRef<HTMLButtonElement | null>(null)

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
  // AppMembers:update + Environments:read

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

  const memberOptions =
    orgMembersData?.organisationMembers.filter(
      (orgMember: OrganisationMemberType) =>
        !data?.appUsers.map((appUser: OrganisationMemberType) => appUser.id).includes(orgMember.id)
    ) ?? []

  const [bulkAddMembers] = useMutation(BulkAddMembersToApp)

  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId: appId,
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

  const [selectedMembers, setSelectedMembers] = useState<OrganisationMemberType[]>([])
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

  const closeModal = () => dialogRef.current?.closeModal()

  const handleAddMembers = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (envScope.length === 0) {
      setShowEnvHint(true)
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
      if (!envScope.map((e) => e.id).includes(env.id)) continue

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

      for (const member of selectedMembers) {
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
    closeModal()
  }

  return (
    <>
      <GenericDialog
        ref={dialogRef}
        title="Add a member"
        buttonContent={
          <>
            <FaPlus /> Add a member
          </>
        }
      >
        {memberOptions.length === 0 ? (
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
              Select a member to add to this App, and choose the Environments that they will be able
              to access.
            </p>
            <div className="relative">
              <Combobox
                multiple
                value={selectedMembers}
                onChange={(members) => setSelectedMembers(members)}
              >
                {({ open }) => (
                  <>
                    <div className="space-y-1">
                      <Combobox.Label as={Fragment}>
                        <label className="block text-neutral-500 text-sm" htmlFor="user">
                          Member
                        </label>
                      </Combobox.Label>
                      <div className="w-full relative flex items-center text-sm">
                        <Combobox.Input
                          id="user"
                          className="w-full"
                          onChange={(event) => setQuery(event.target.value)}
                          onClick={() => (!open ? comboboxButtonRef.current?.click() : {})}
                          onFocus={() => (!open ? comboboxButtonRef.current?.click() : {})}
                          required
                          placeholder="Select a member"
                          displayValue={(members: OrganisationMemberType[]) =>
                            members.map((member) => member.fullName || member.email).join(', ')
                          }
                        />
                        <div className="absolute inset-y-0 right-2 flex items-center">
                          <Combobox.Button ref={comboboxButtonRef}>
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

                    <Combobox.Options as={Fragment}>
                      <div className="bg-neutral-200 dark:bg-neutral-800 p-1 rounded-b-md shadow-xl z-10 divide-y divide-neutral-500/20 absolute w-full max-h-96 overflow-y-auto ring-1 ring-inset ring-neutral-500/40">
                        {filteredPeople.map((person: OrganisationMemberType) => (
                          <Combobox.Option as={Fragment} key={person.id} value={person}>
                            {({ active, selected }) => (
                              <div
                                className={clsx(
                                  'flex items-center justify-between cursor-pointer transition ease',
                                  active
                                    ? 'text-zinc-900 dark:text-zinc-100 bg-neutral-100 dark:bg-neutral-700'
                                    : 'text-zinc-700 dark:text-zinc-300'
                                )}
                              >
                                <div className={clsx('flex items-center gap-2 p-1 text-sm')}>
                                  <Avatar member={person} size="md" />
                                  <div>
                                    <div className="font-semibold">
                                      {person.fullName || person.email}
                                    </div>
                                    {person.fullName && (
                                      <div className="text-neutral-500 text-xs leading-4">
                                        {person.email}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="px-2">
                                  {selected && <FaCheckCircle className="text-emerald-500" />}
                                </div>
                              </div>
                            )}
                          </Combobox.Option>
                        ))}
                      </div>
                    </Combobox.Options>
                  </>
                )}
              </Combobox>
            </div>

            {userCanReadEnvironments ? (
              <div className="space-y-1 w-full relative">
                <Listbox
                  by="id"
                  value={envScope}
                  onChange={setEnvScope}
                  multiple
                  name="environments"
                >
                  {({ open }) => (
                    <>
                      <Listbox.Label as={Fragment}>
                        <div className="flex items-center justify-between">
                          <label className="block text-neutral-500 text-sm" htmlFor="envs">
                            Environment scope
                          </label>
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              type="button"
                              onClick={() => setEnvScope(envOptions)}
                              disabled={envScope.length === envOptions.length}
                            >
                              <div className="flex items-center gap-1 text-2xs">
                                <FaAsterisk /> Select all
                              </div>
                            </Button>
                            {envScope.length === 0 && showEnvHint && (
                              <span className="absolute right-2 inset-y-0 text-red-500 text-xs">
                                Select an environment scope
                              </span>
                            )}
                          </div>
                        </div>
                      </Listbox.Label>
                      <Listbox.Button as={Fragment} aria-required>
                        <div className="p-2 flex items-center justify-between bg-zinc-100 dark:bg-zinc-800 border border-neutral-500/40 rounded-md cursor-pointer h-10">
                          <span className="text-zinc-900 dark:text-zinc-100 text-sm">
                            {envScope.map((env: Partial<EnvironmentType>) => env.name).join(' + ')}
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
                          <div className="bg-neutral-200 dark:bg-neutral-800 p-2 rounded-md border border-neutral-500/40 shadow-2xl absolute z-10 w-full divide-y divide-neutral-500/20">
                            {envOptions.map((env: Partial<EnvironmentType>) => (
                              <Listbox.Option key={env.id} value={env} as={Fragment}>
                                {({ active, selected }) => (
                                  <div
                                    className={clsx(
                                      'flex items-center gap-2 p-1 cursor-pointer text-sm rounded-sm transition ease',
                                      active
                                        ? 'text-zinc-900 dark:text-zinc-100 bg-neutral-100 dark:bg-neutral-700'
                                        : '',
                                      selected && 'text-zinc-900 dark:text-zinc-100'
                                    )}
                                  >
                                    {selected ? (
                                      <FaCheckCircle className="text-emerald-500" />
                                    ) : (
                                      <FaCircle />
                                    )}
                                    <div>{env.name}</div>
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
                You don&apos;t have permission to read Environments. This permission is required to
                set an environment scope for members in this App.
              </Alert>
            )}

            <div className="flex items-center gap-4">
              <Button variant="secondary" type="button" onClick={closeModal}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={envScope.length === 0 || selectedMembers === null}
              >
                Add
              </Button>
            </div>
          </form>
        )}
      </GenericDialog>
    </>
  )
}
