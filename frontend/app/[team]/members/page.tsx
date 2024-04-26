'use client'

import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import GetInvites from '@/graphql/queries/organisation/getInvites.gql'
import GetApps from '@/graphql/queries/getApps.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import InviteMember from '@/graphql/mutations/organisation/inviteNewMember.gql'
import DeleteOrgInvite from '@/graphql/mutations/organisation/deleteInvite.gql'
import RemoveMember from '@/graphql/mutations/organisation/deleteOrgMember.gql'
import UpdateMemberRole from '@/graphql/mutations/organisation/updateOrgMemberRole.gql'
import AddMemberToApp from '@/graphql/mutations/apps/addAppMember.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useState } from 'react'
import {
  OrganisationMemberInviteType,
  OrganisationMemberType,
  AppType,
  ApiOrganisationMemberRoleChoices,
  EnvironmentType,
} from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { relativeTimeFromDates } from '@/utils/time'
import { Dialog, Listbox, Transition } from '@headlessui/react'
import { FaChevronDown, FaCopy, FaPlus, FaTimes, FaTrashAlt, FaUserAlt } from 'react-icons/fa'
import clsx from 'clsx'
import { cryptoUtils } from '@/utils/auth'
import { copyToClipBoard } from '@/utils/clipboard'
import { toast } from 'react-toastify'
import { Avatar } from '@/components/common/Avatar'
import { userIsAdmin } from '@/utils/permissions'
import { RoleLabel } from '@/components/users/RoleLabel'
import { KeyringContext } from '@/contexts/keyringContext'
import { unwrapEnvSecretsForUser, wrapEnvSecretsForUser } from '@/utils/environments'
import { Alert } from '@/components/common/Alert'
import { Input } from '@/components/common/Input'
import CopyButton from '@/components/common/CopyButton'

const handleCopy = (val: string) => {
  copyToClipBoard(val)
  toast.info('Copied', { autoClose: 2000 })
}

const inviteIsExpired = (invite: OrganisationMemberInviteType) => {
  return new Date(invite.expiresAt) < new Date()
}

const RoleSelector = (props: { member: OrganisationMemberType }) => {
  const { member } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { keyring } = useContext(KeyringContext)

  const { data: appsData, loading: appsLoading } = useQuery(GetApps, {
    variables: { organisationId: organisation!.id },
  })
  const [getAppEnvs] = useLazyQuery(GetAppEnvironments)
  const [getEnvKey] = useLazyQuery(GetEnvironmentKey)
  const [updateRole] = useMutation(UpdateMemberRole)
  const [addMemberToApp] = useMutation(AddMemberToApp)

  const [role, setRole] = useState<string>(member.role)

  const isOwner = role.toLowerCase() === 'owner'

  const activeUserIsAdmin = organisation ? userIsAdmin(organisation.role!) : false

  /**
   * Handles the upgrade of a user from 'dev' to 'admin'.
   * Env keys for all apps, are fetched and decrypted by the active user, then each key is re-encrypted for the new user and saved on the backend via the addMemberToApp mutation
   *
   * @returns {void}
   */
  const upgradeDevToAdmin = () => {
    if (appsData) {
      const apps = appsData.apps

      // Function to process an individual app
      const processApp = async (app: AppType) => {
        //const keyring = await validateKeyring(password);
        const { data: appEnvsData } = await getAppEnvs({ variables: { appId: app.id } })

        const appEnvironments = appEnvsData.appEnvironments as EnvironmentType[]

        const envKeyPromises = appEnvironments.map(async (env: EnvironmentType) => {
          const { data } = await getEnvKey({
            variables: {
              envId: env.id,
              appId: app.id,
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

          const { wrappedSeed, wrappedSalt } = await wrapEnvSecretsForUser({ seed, salt }, member)

          return {
            envId: env.id,
            userId: member.id,
            identityKey,
            wrappedSeed,
            wrappedSalt,
          }
        })

        const envKeyInputs = await Promise.all(envKeyPromises)

        await addMemberToApp({
          variables: { memberId: member.id, appId: app.id, envKeys: envKeyInputs },
        })
      }

      // Process each app sequentially
      const processAppsSequentially = async () => {
        for (const app of apps) {
          await processApp(app)
        }
      }

      // Call the function to process all apps sequentially
      processAppsSequentially()
        .then(async () => {
          // All apps have been processed
          await updateRole({
            variables: {
              memberId: member.id,
              role: 'admin',
            },
          })
          toast.success('Updated member role', { autoClose: 2000 })
        })
        .catch((error) => {
          console.error('Error processing apps:', error)
        })
    }
  }

  const handleUpdateRole = async (newRole: string) => {
    setRole(newRole)
    if (newRole.toLowerCase() === 'admin') upgradeDevToAdmin()
    else {
      await updateRole({
        variables: {
          memberId: member.id,
          role: newRole,
        },
      })
      toast.success('Updated member role', { autoClose: 2000 })
    }
  }

  const roleOptions = Object.keys(ApiOrganisationMemberRoleChoices).filter(
    (option) => option !== 'Owner'
  )

  const disabled = isOwner || !activeUserIsAdmin || member.self!

  return disabled ? (
    <RoleLabel role={role} />
  ) : (
    <div className="space-y-1 w-full relative">
      <Listbox disabled={disabled} value={role} onChange={handleUpdateRole}>
        {({ open }) => (
          <>
            <Listbox.Button as={Fragment} aria-required>
              <div
                className={clsx(
                  'p-2 flex items-center justify-between  rounded-md h-10',
                  disabled ? 'cursor-not-allowed' : 'cursor-pointer'
                )}
              >
                <RoleLabel role={role} />
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
            <Listbox.Options>
              <div className="bg-zinc-300 dark:bg-zinc-800 p-2 rounded-md shadow-2xl absolute z-10 w-full">
                {roleOptions.map((role: string) => (
                  <Listbox.Option key={role} value={role} as={Fragment}>
                    {({ active, selected }) => (
                      <div
                        className={clsx(
                          'flex items-center gap-2 p-2 cursor-pointer rounded-full',
                          active && 'bg-zinc-400 dark:bg-zinc-700'
                        )}
                      >
                        <RoleLabel role={role} />
                      </div>
                    )}
                  </Listbox.Option>
                ))}
              </div>
            </Listbox.Options>
          </>
        )}
      </Listbox>
    </div>
  )
}

const InviteDialog = (props: { organisationId: string }) => {
  const { organisationId } = props

  const [createInvite, { error, loading: mutationLoading }] = useMutation(InviteMember)

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const [email, setEmail] = useState<string>('')

  const [inviteLink, setInviteLink] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string>('')

  const reset = () => {
    setEmail('')
    setInviteLink('')
    setErrorMessage('')
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

  useEffect(() => {
    if (error) setErrorMessage(error.message)
  }, [error])

  const handleInvite = async (event: { preventDefault: () => void }) => {
    event.preventDefault()
    const { data } = await createInvite({
      variables: {
        email,
        orgId: organisationId,
        apps: [],
        role: 'dev',
      },
      refetchQueries: [
        {
          query: GetInvites,
          variables: {
            orgId: organisationId,
          },
        },
      ],
      fetchPolicy: 'network-only',
    })

    setInviteLink(cryptoUtils.getInviteLink(data?.inviteOrganisationMember.invite.id))
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
                <Dialog.Panel className="w-full max-w-screen-sm transform overflow-hidden rounded-2xl bg-neutral-100 dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg font-medium leading-6 text-black dark:text-white ">
                      Invite a new member
                    </h3>

                    <Button variant="text" onClick={handleClose}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>

                  <div className="space-y-4 divide-y divide-neutral-500/40">
                    <p className="text-neutral-500">
                      Invite a user to your Organisation.
                    </p>
                    <div>
                      {!inviteLink && (
                        <form className="space-y-8 py-4" onSubmit={handleInvite}>
                          {errorMessage && (
                            <Alert variant="danger" icon={true}>
                              {errorMessage}
                            </Alert>
                          )}

                          <p className="text-neutral-500">
                            Enter the email address of the user you want to invite below. An invitation link will be sent to this email address.
                          </p>

                          <Alert variant="info" icon={true}>
                            <p>
                              You will need to manually provision access to <strong>  applications </strong> and  <strong> environments </strong> after the member has joined the organization.
                            </p>
                          </Alert>
                          <div className="w-full">
                            <Input
                              value={email}
                              setValue={(value) => setEmail(value)}
                              label="User email"
                              type="email"
                              required
                              autoFocus
                            />
                          </div>

                          <div className="col-span-2 flex items-center gap-4 justify-end">
                            <Button variant="secondary" type="button" onClick={closeModal}>
                              Cancel
                            </Button>
                            <Button variant="primary" type="submit" isLoading={mutationLoading}>
                              Invite
                            </Button>
                          </div>
                        </form>
                      )}
                      {inviteLink && (
                        <div className="py-8 space-y-6">
                          <div className="text-center max-w-lg mx-auto">
                            <h3 className="font-semibold text-xl text-black dark:text-white">
                              Invite sent!
                            </h3>
                            <p className="text-neutral-500">
                              An invite link has been sent by email to{' '}
                              <span className="font-medium text-black dark:text-white">
                                {email}
                              </span>
                              . You can also share the link below to invite this user to your
                              organisation. This invite will expire in 72 hours.
                            </p>
                          </div>

                          <div className="group relative overflow-x-hidden rounded-lg border border-neutral-500/40 bg-zinc-300/50 dark:bg-zinc-800/50 p-3 text-left text-emerald-800 dark:text-emerald-300">
                            <pre className="ph-no-capture text-sm">{inviteLink}</pre>
                            <div className="absolute inset-0 w-full h-full bg-gradient-to-r from-transparent to-zinc-300 dark:to-zinc-800"></div>
                            <div className="absolute right-1 top-2.5 ">
                              <CopyButton value={inviteLink} defaultHidden={false} />
                            </div>
                          </div>

                          <Alert variant="info" icon={true} size="sm">
                            You can add users to specific Apps and Environments once they accept
                            this invite and join your Organisation.
                          </Alert>
                        </div>
                      )}
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

export default function Members({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data: membersData } = useQuery(GetOrganisationMembers, {
    variables: {
      organisationId: organisation?.id,
      role: null,
    },
    pollInterval: 5000,
    skip: !organisation,
  })

  const { data: invitesData } = useQuery(GetInvites, {
    variables: {
      orgId: organisation?.id,
    },
    pollInterval: 5000,
    skip: !organisation,
  })

  const [deleteInvite] = useMutation(DeleteOrgInvite)

  const sortedInvites: OrganisationMemberInviteType[] =
    invitesData?.organisationInvites
      ?.slice() // Create a shallow copy of the array to avoid modifying the original
      .sort((a: OrganisationMemberInviteType, b: OrganisationMemberInviteType) => {
        // Compare the createdAt timestamps in descending order
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      }) || []

  const activeUserIsAdmin = organisation ? userIsAdmin(organisation.role!) : false

  const DeleteInviteConfirmDialog = (props: { inviteId: string }) => {
    const { inviteId } = props

    const [isOpen, setIsOpen] = useState<boolean>(false)

    const closeModal = () => {
      setIsOpen(false)
    }

    const openModal = () => {
      setIsOpen(true)
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
              orgId: organisation?.id,
            },
          },
        ],
      })
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

    const allowDelete = !member.self! && activeUserIsAdmin && member.role.toLowerCase() !== 'owner'

    return (
      <>
        {allowDelete && (
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
        )}

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
                        organisation?
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
    <section className="h-screen overflow-y-auto">
      <div className="w-full space-y-10 p-8 text-black dark:text-white">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">{params.team} Members</h1>
          <p className="text-neutral-500">Manage organisation members and roles.</p>
        </div>
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
            <tbody className="divide-y divide-zinc-500/40">
              {membersData?.organisationMembers.map((member: OrganisationMemberType) => (
                <tr key={member.id}>
                  <td className="px-6 py-4 whitespace-nowrap flex items-center gap-2">
                    <Avatar imagePath={member.avatarUrl!} size="lg" />
                    <div className="flex flex-col">
                      <span className="text-lg font-medium">{member.fullName || member.email}</span>
                      {member.fullName && (
                        <span className="text-neutral-500 text-sm">{member.email}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <RoleSelector member={member} />
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap capitalize">
                    {relativeTimeFromDates(new Date(member.createdAt))}
                  </td>
                  <td className="px-6 py-4 flex items-center justify-end gap-2">
                    {!member.self! &&
                      activeUserIsAdmin &&
                      member.role.toLowerCase() !== 'owner' && (
                        <DeleteMemberConfirmDialog member={member} />
                      )}
                  </td>
                </tr>
              ))}
              {sortedInvites.map((invite: OrganisationMemberInviteType) => (
                <tr key={invite.id} className="opacity-60">
                  <td className="px-6 py-4 whitespace-nowrap flex items-center gap-2">
                    <div className="flex rounded-full items-center justify-center h-12 w-12 bg-neutral-500">
                      <FaUserAlt />
                    </div>
                    <div className="flex flex-col">
                      <div className="text-base font-medium">
                        {invite.inviteeEmail}{' '}
                        <span className="text-neutral-500 text-sm">
                          (invited by{' '}
                          {invite.invitedBy.self
                            ? 'You'
                            : invite.invitedBy.fullName || invite.invitedBy.email}
                          )
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap"></td>
                  <td
                    className={clsx(
                      'px-6 py-4 whitespace-nowrap',
                      inviteIsExpired(invite) && 'text-red-500'
                    )}
                  >
                    {inviteIsExpired(invite)
                      ? `Expired ${relativeTimeFromDates(new Date(invite.expiresAt))}`
                      : `Invited ${relativeTimeFromDates(new Date(invite.createdAt))}`}
                  </td>
                  <td className="px-6 py-4 flex items-center justify-end gap-2">
                    {!inviteIsExpired(invite) && (
                      <Button
                        variant="outline"
                        title="Copy invite link"
                        onClick={() => handleCopy(cryptoUtils.getInviteLink(invite.id))}
                      >
                        <div className="p-1">
                          <FaCopy />
                        </div>
                      </Button>
                    )}
                    <DeleteInviteConfirmDialog inviteId={invite.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
