'use client'

import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import GetInvites from '@/graphql/queries/organisation/getInvites.gql'
import GetApps from '@/graphql/queries/getApps.gql'
import InviteMember from '@/graphql/mutations/organisation/inviteNewMember.gql'
import DeleteInvite from '@/graphql/mutations/organisation/deleteInvite.gql'
import RemoveMember from '@/graphql/mutations/organisation/deleteOrgMember.gql'
import UpdateMemberRole from '@/graphql/mutations/organisation/updateOrgMemberRole.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useState } from 'react'
import {
  OrganisationMemberInviteType,
  OrganisationMemberType,
  AppType,
  ApiOrganisationMemberRoleChoices,
} from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { relativeTimeFromDates } from '@/utils/time'
import { Dialog, Disclosure, Listbox, RadioGroup, Transition } from '@headlessui/react'
import {
  FaCheckSquare,
  FaChevronDown,
  FaCircle,
  FaCopy,
  FaDotCircle,
  FaPlus,
  FaSquare,
  FaTimes,
  FaTrashAlt,
} from 'react-icons/fa'
import clsx from 'clsx'
import { cryptoUtils } from '@/utils/auth'
import { copyToClipBoard } from '@/utils/clipboard'
import { toast } from 'react-toastify'
import { useSession } from 'next-auth/react'
import { Avatar } from '@/components/common/Avatar'
import { userIsAdmin } from '@/utils/permissions'
import { RoleLabel } from '@/components/users/RoleLabel'

const handleCopy = (val: string) => {
  copyToClipBoard(val)
  toast.info('Copied', { autoClose: 2000 })
}

const RoleSelector = (props: { member: OrganisationMemberType }) => {
  const { member } = props

  const [updateRole] = useMutation(UpdateMemberRole)

  const [role, setRole] = useState<string>(member.role)

  const isOwner = role.toLowerCase() === 'owner'

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const activeUserIsAdmin = organisation ? userIsAdmin(organisation.role!) : false

  const handleUpdateRole = async (newRole: string) => {
    setRole(newRole)
    await updateRole({
      variables: {
        memberId: member.id,
        role: newRole,
      },
    })
    toast.success('Updated member role', { autoClose: 2000 })
  }

  const roleOptions = Object.keys(ApiOrganisationMemberRoleChoices).filter(
    (option) => option !== 'Owner'
  )

  const disabled = isOwner || !activeUserIsAdmin

  return disabled ? (
    <RoleLabel role={role} />
  ) : (
    <Listbox disabled={disabled} value={role} onChange={handleUpdateRole}>
      {({ open }) => (
        <>
          <Listbox.Button as={Fragment} aria-required>
            <div
              className={clsx(
                'p-2 flex items-center justify-between bg-zinc-300 dark:bg-zinc-800 rounded-md h-10',
                disabled ? 'cursor-not-allowed' : 'cursor-pointer'
              )}
            >
              <span
                className={clsx(
                  'capitalize',
                  disabled ? 'text-neutral-500' : 'text-black dark:text-white'
                )}
              >
                {role.toLowerCase()}
              </span>
              {!disabled && (
                <FaChevronDown
                  className={clsx(
                    'transition-transform ease duration-300 text-neutral-500',
                    open ? 'rotate-180' : 'rotate-0'
                  )}
                />
              )}
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
              <div className="bg-zinc-300 dark:bg-zinc-800 p-2 rounded-md shadow-2xl absolute z-20 w-full">
                {roleOptions.map((role: string) => (
                  <Listbox.Option key={role} value={role} as={Fragment}>
                    {({ active, selected }) => (
                      <div
                        className={clsx(
                          'flex items-center gap-2 p-2 cursor-pointer',
                          active && 'font-semibold'
                        )}
                      >
                        <span className="text-black dark:text-white">{role}</span>
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
  )
}

const InviteDialog = (props: { organisationId: string }) => {
  const { organisationId } = props

  const { data: invitesData, loading: invitesLoading } = useQuery(GetInvites, {
    variables: { orgId: organisationId },
  })
  const { data: appsData, loading: appsLoading } = useQuery(GetApps, {
    variables: { organisationId, appId: '' },
  })
  const [createInvite] = useMutation(InviteMember)
  const [deleteInvite] = useMutation(DeleteInvite)

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const [email, setEmail] = useState<string>('')
  const [role, setRole] = useState<string>('Dev')
  const [apps, setApps] = useState<Partial<AppType>[]>([])

  const [inviteLink, setInviteLink] = useState<string>('')

  const roleOptions = Object.keys(ApiOrganisationMemberRoleChoices).filter(
    (option) => option !== 'Owner'
  )

  const isLoading = invitesLoading || appsLoading

  const reset = () => {
    setEmail('')
    setRole('Dev')
    setApps([])
    setInviteLink('')
  }

  const closeModal = () => {
    reset()
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const handleClose = () => {
    closeModal()
  }

  const handleInvite = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    const { data } = await createInvite({
      variables: {
        email,
        orgId: organisationId,
        apps: apps.map((app) => app.id),
        role,
      },
      refetchQueries: [
        {
          query: GetInvites,
          variables: {
            orgId: organisationId,
          },
        },
      ],
    })

    setInviteLink(cryptoUtils.getInviteLink(data?.inviteOrganisationMember.invite.id))
  }

  const handleDeleteInvite = async (inviteId: string) => {
    await deleteInvite({
      variables: {
        inviteId,
      },
      refetchQueries: [
        {
          query: GetInvites,
          variables: {
            orgId: organisationId,
          },
        },
      ],
    })
  }

  const AppSelector = (props: { app: AppType }) => {
    const { id: appId, name: appName } = props.app

    const isSelected = apps.map((app) => app.name).includes(appName)

    const handleAppClick = () => {
      if (isSelected) {
        setApps(apps.filter((app) => app.name !== appName))
      } else setApps([...apps, ...[{ id: appId, name: appName }]])
    }

    return (
      <div
        className="flex items-center gap-2 p-2 rounded-md cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-colors ease"
        onClick={handleAppClick}
      >
        {isSelected ? (
          <FaCheckSquare className="text-emerald-500" />
        ) : (
          <FaSquare className="text-zinc-300 dark:text-zinc-700" />
        )}
        <div
          className={clsx(
            isSelected ? 'opacity-100 font-medium' : 'opacity-70',
            'transition-opacity ease text-black dark:text-white'
          )}
        >
          <span>{appName}</span>
        </div>
      </div>
    )
  }

  const sortedInvites: OrganisationMemberInviteType[] =
    invitesData?.organisationInvites
      ?.slice() // Create a shallow copy of the array to avoid modifying the original
      .sort((a: OrganisationMemberInviteType, b: OrganisationMemberInviteType) => {
        // Compare the createdAt timestamps in descending order
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      }) || []

  const DeleteInviteConfirmDialog = (props: { inviteId: string }) => {
    const { inviteId } = props

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
          <Button variant="danger" onClick={openModal} title="Delete invite">
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
                        Delete Invite
                      </h3>

                      <Button variant="text" onClick={closeModal}>
                        <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>

                    <div className="space-y-6 p-4">
                      <p className="text-neutral-500">
                        Are you sure you want to delete this invite?
                      </p>
                      <div className="flex items-center gap-4">
                        <Button variant="secondary" type="button" onClick={closeModal}>
                          Cancel
                        </Button>
                        <Button variant="danger" onClick={() => handleDeleteInvite(inviteId)}>
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
                <Dialog.Panel className="w-full max-w-screen-lg transform overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                      Invite a new member
                    </h3>

                    <Button variant="text" onClick={handleClose}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  {!isLoading && (
                    <div className="space-y-4 divide-y divide-neutral-500/40">
                      <div>
                        {!inviteLink && (
                          <form className="grid grid-cols-2 gap-10 p-4" onSubmit={handleInvite}>
                            <div className="space-y-4">
                              <div className="space-y-2 w-full">
                                <label
                                  className="block text-gray-700 text-sm font-bold mb-2"
                                  htmlFor="name"
                                >
                                  User email
                                </label>
                                <input
                                  required
                                  id="name"
                                  type="email"
                                  value={email}
                                  onChange={(e) => setEmail(e.target.value)}
                                />
                              </div>
                              <div>
                                <RadioGroup value={role} onChange={setRole}>
                                  <RadioGroup.Label as={Fragment}>
                                    <label className="block text-gray-700 text-sm font-bold mb-2">
                                      Role
                                    </label>
                                  </RadioGroup.Label>
                                  <div className="flex flex-wrap items-center gap-2">
                                    {roleOptions.map((option) => (
                                      <RadioGroup.Option key={option} value={option} as={Fragment}>
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
                                            {option}
                                          </div>
                                        )}
                                      </RadioGroup.Option>
                                    ))}
                                  </div>
                                </RadioGroup>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <label className="block text-gray-700 text-sm font-bold mb-2">
                                App access
                              </label>
                              {appsData.apps.map((appOption: AppType) => (
                                <AppSelector key={appOption.id} app={appOption} />
                              ))}
                            </div>

                            <div className="col-span-2 flex items-center gap-4 justify-end">
                              <Button variant="secondary" type="button" onClick={closeModal}>
                                Cancel
                              </Button>
                              <Button variant="primary" type="submit">
                                Invite
                              </Button>
                            </div>
                          </form>
                        )}
                        {inviteLink && (
                          <div className="py-4 space-y-6">
                            <div className="text-center max-w-lg mx-auto">
                              <h3 className="font-semibold text-xl">Invite sent</h3>
                              <p className="text-neutral-500">
                                An invite link has been sent by email to {email}. You can also share
                                the link below to invite the user to your organisation.
                              </p>
                            </div>
                            <div className="p-6 flex items-center justify-between rounded-md bg-zinc-200 dark:bg-zinc-800">
                              <div className="text-emerald-500 font-mono font-semibold">
                                {inviteLink}
                              </div>
                              <Button variant="outline" onClick={() => handleCopy(inviteLink)}>
                                Copy <FaCopy />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="space-y-6 p-4">
                        <Disclosure>
                          {({ open }) => (
                            <>
                              <Disclosure.Button as={Fragment}>
                                <div className="py-2 cursor-pointer font-medium flex items-center gap-4 text-black dark:text-white">
                                  <FaChevronDown
                                    className={clsx(
                                      'transition-transform ease duration-300 text-neutral-500',
                                      open ? 'rotate-180' : 'rotate-0'
                                    )}
                                  />
                                  Invite history
                                </div>
                              </Disclosure.Button>
                              <Transition
                                enter="transition duration-100 ease-out"
                                enterFrom="transform scale-95 opacity-0"
                                enterTo="transform scale-100 opacity-100"
                                leave="transition duration-75 ease-out"
                                leaveFrom="transform scale-100 opacity-100"
                                leaveTo="transform scale-95 opacity-0"
                              >
                                <Disclosure.Panel>
                                  <div className="max-h-96 overflow-y-auto text-sm">
                                    <table className="table-auto min-w-full divide-y divide-zinc-500/40">
                                      <thead className="sticky top-0 bg-zinc-100 dark:bg-zinc-900">
                                        <tr>
                                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Email
                                          </th>
                                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Invited by
                                          </th>
                                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Invited
                                          </th>
                                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                            Expires
                                          </th>
                                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"></th>
                                        </tr>
                                      </thead>
                                      <tbody className="bg-zinc-200 dark:bg-zinc-800 divide-y text-black dark:text-white divide-zinc-500/40">
                                        {sortedInvites.map(
                                          (invite: OrganisationMemberInviteType) => (
                                            <tr key={invite.id}>
                                              <td className="px-6 py-4 whitespace-nowrap">
                                                {invite.inviteeEmail}
                                              </td>
                                              <td className="px-6 py-4 whitespace-nowrap">
                                                {invite.invitedBy.email}
                                              </td>
                                              <td className="px-6 py-4 whitespace-nowrap capitalize">
                                                {relativeTimeFromDates(new Date(invite.createdAt))}
                                              </td>
                                              <td className="px-6 py-4 whitespace-nowrap capitalize">
                                                {relativeTimeFromDates(new Date(invite.expiresAt))}
                                              </td>
                                              <td className="px-6 py-4 flex items-center gap-2">
                                                <Button
                                                  variant="outline"
                                                  title="Copy invite link"
                                                  onClick={() =>
                                                    handleCopy(cryptoUtils.getInviteLink(invite.id))
                                                  }
                                                >
                                                  <div className="p-1">
                                                    <FaCopy />
                                                  </div>
                                                </Button>
                                                <DeleteInviteConfirmDialog inviteId={invite.id} />
                                              </td>
                                            </tr>
                                          )
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </Disclosure.Panel>
                              </Transition>
                            </>
                          )}
                        </Disclosure>
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

export default function Members({ params }: { params: { team: string } }) {
  const [getMembers, { data: membersData }] = useLazyQuery(GetOrganisationMembers)

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const activeUserIsAdmin = organisation ? userIsAdmin(organisation.role!) : false

  const { data: session } = useSession()

  useEffect(() => {
    if (organisation) {
      getMembers({
        variables: {
          organisationId: organisation.id,
          role: null,
        },
      })
    }
  }, [getMembers, organisation])

  const DeleteMemberConfirmDialog = (props: { member: OrganisationMemberType }) => {
    const { member } = props

    const [removeMember] = useMutation(RemoveMember)

    const [isOpen, setIsOpen] = useState<boolean>(false)

    const closeModal = () => {
      setIsOpen(false)
    }

    const openModal = () => {
      setIsOpen(true)
    }

    const handleRemoveMember = async () => {
      await removeMember({
        variables: { memberId: member.id },
        refetchQueries: [
          {
            query: GetOrganisationMembers,
            variables: { organisationId: organisation?.id, role: null },
          },
        ],
      })
    }

    return (
      <>
        <div className="flex items-center justify-center">
          <Button
            variant="danger"
            onClick={openModal}
            title="Remove member"
            disabled={member.role.toLowerCase() === 'owner'}
          >
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
                        Remove member
                      </h3>

                      <Button variant="text" onClick={closeModal}>
                        <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                      </Button>
                    </Dialog.Title>

                    <div className="space-y-6 p-4">
                      <p className="text-neutral-500">
                        Are you sure you want to remove {member.fullName} from this organisation?
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

  return (
    <div className="w-full space-y-10 p-8 text-black dark:text-white">
      <h1 className="text-2xl font-semibold">{params.team} Members</h1>

      <div className="Space-y-4">
        <div className="flex justify-end">
          {organisation && <InviteDialog organisationId={organisation.id} />}
        </div>

        <table className="table-auto min-w-full divide-y divide-zinc-500/40">
          <thead>
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                User
              </th>

              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Role
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Joined
              </th>
              {activeUserIsAdmin && <th className="px-6 py-3"></th>}
            </tr>
          </thead>
          <tbody className="bg-zinc-200 dark:bg-zinc-800 divide-y divide-zinc-500/40">
            {membersData?.organisationMembers.map((member: OrganisationMemberType) => (
              <tr key={member.id}>
                <td className="px-6 py-4 whitespace-nowrap flex items-center gap-2">
                  <Avatar imagePath={member.avatarUrl!} size="lg" />
                  <div className="flex flex-col">
                    <span className="text-lg font-medium">{member.fullName}</span>
                    <span className="text-neutral-500 text-sm">{member.email}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <RoleSelector member={member} />
                </td>
                <td className="px-6 py-4 whitespace-nowrap capitalize">
                  {relativeTimeFromDates(new Date(member.createdAt))}
                </td>
                <td>
                  {member.email !== session?.user?.email && activeUserIsAdmin && (
                    <DeleteMemberConfirmDialog member={member} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
