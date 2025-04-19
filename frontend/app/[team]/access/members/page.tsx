'use client'

import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import GetInvites from '@/graphql/queries/organisation/getInvites.gql'
import GetApps from '@/graphql/queries/getApps.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'

import DeleteOrgInvite from '@/graphql/mutations/organisation/deleteInvite.gql'
import RemoveMember from '@/graphql/mutations/organisation/deleteOrgMember.gql'
import UpdateMemberRole from '@/graphql/mutations/organisation/updateOrgMemberRole.gql'
import AddMemberToApp from '@/graphql/mutations/apps/addAppMember.gql'

import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useState } from 'react'
import {
  OrganisationMemberInviteType,
  OrganisationMemberType,
  AppType,
  EnvironmentType,
  RoleType,
} from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { relativeTimeFromDates } from '@/utils/time'
import { Dialog, Listbox, Transition } from '@headlessui/react'
import { FaBan, FaChevronDown, FaCopy, FaTimes, FaTrashAlt, FaUserAlt, FaChevronRight } from 'react-icons/fa'
import clsx from 'clsx'
import Link from 'next/link'

import { copyToClipBoard } from '@/utils/clipboard'
import { toast } from 'react-toastify'
import { Avatar } from '@/components/common/Avatar'
import { PermissionPolicy, userHasGlobalAccess } from '@/utils/access/permissions'
import { RoleLabel } from '@/components/users/RoleLabel'
import { KeyringContext } from '@/contexts/keyringContext'

import { getInviteLink, unwrapEnvSecretsForUser, wrapEnvSecretsForAccount } from '@/utils/crypto'
import { userHasPermission } from '@/utils/access/permissions'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'
import { updateServiceAccountHandlers } from '@/utils/crypto/service-accounts'
import { InviteDialog } from './_components/InviteDialog'

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

  const userCanReadApps = userHasPermission(organisation?.role?.permissions, 'Apps', 'read')

  const userCanUpdateMemberRoles = organisation
    ? userHasPermission(organisation.role!.permissions, 'Members', 'update') &&
      userHasPermission(organisation.role!.permissions, 'Roles', 'read')
    : false

  const { data: appsData } = useQuery(GetApps, {
    variables: { organisationId: organisation!.id },
    skip: !userCanReadApps,
  })

  const { data: roleData, loading: roleDataPending } = useQuery(GetRoles, {
    variables: { orgId: organisation!.id },
    skip: !userCanUpdateMemberRoles,
  })
  const [getAppEnvs] = useLazyQuery(GetAppEnvironments)
  const [getEnvKey] = useLazyQuery(GetEnvironmentKey)
  const [updateRole] = useMutation(UpdateMemberRole)
  const [addMemberToApp] = useMutation(AddMemberToApp)

  const [role, setRole] = useState<RoleType>(member.role!)

  const isOwner = role.name!.toLowerCase() === 'owner'

  /**
   * Handles the assignment of a user to a global access role.
   * Env keys for all apps are fetched and decrypted by the active user,
   * then each key is re-encrypted for the new user and saved on the backend via the addMemberToApp mutation.
   *
   * @returns {Promise<void>}
   */
  const assignGlobalAccess = async (): Promise<void> => {
    if (!appsData) {
      return Promise.reject(new Error('No apps data available'))
    }

    const apps = appsData.apps

    // Function to process an individual app
    const processApp = async (app: AppType) => {
      try {
        // Fetch envs for the app
        const { data: appEnvsData } = await getAppEnvs({ variables: { appId: app.id } })
        const appEnvironments = appEnvsData.appEnvironments as EnvironmentType[]

        // Construct promises to encrypt each env key for the target user
        const envKeyPromises = appEnvironments.map(async (env: EnvironmentType) => {
          // Fetch the current wrapped key for the environment
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

          // Unwrap env keys for current logged in user
          const { seed, salt } = await unwrapEnvSecretsForUser(
            userWrappedSeed,
            userWrappedSalt,
            keyring!
          )

          // Re-encrypt the env key for the target user
          const { wrappedSeed, wrappedSalt } = await wrapEnvSecretsForAccount(
            { seed, salt },
            member
          )

          // Return the mutation payload
          return {
            envId: env.id,
            userId: member.id,
            identityKey,
            wrappedSeed,
            wrappedSalt,
          }
        })

        // Get mutation payloads with wrapped keys for each environment
        const envKeyInputs = await Promise.all(envKeyPromises)

        // Add the user to this app, with wrapped keys for each environment
        await addMemberToApp({
          variables: { memberId: member.id, appId: app.id, envKeys: envKeyInputs },
        })
      } catch (error) {
        console.error(`Error processing app ${app.id}:`, error)
        throw error // Propagate the error to be caught later
      }
    }

    try {
      // Process each app sequentially using for...of to ensure async operations complete in order
      for (const app of apps) {
        await processApp(app)
      }

      // After all apps have been processed, assign the global admin role
      const adminRole = roleOptions.find(
        (option: RoleType) => option.name?.toLowerCase() === 'admin'
      )

      if (adminRole) {
        await updateRole({
          variables: {
            memberId: member.id,
            roleId: adminRole.id,
          },
        })
      } else {
        throw new Error('Admin role not found')
      }
    } catch (error) {
      console.error('Error assigning global access:', error)
      throw error // Ensure the promise rejects if any error occurs
    }
  }

  const handleUpdateRole = async (newRole: RoleType) => {
    const currentRoleHasGlobalAccess = userHasGlobalAccess(member.role?.permissions)
    const newRoleHasGlobalAccess = userHasGlobalAccess(newRole.permissions)
    const currentUserHasGlobalAccess = userHasGlobalAccess(organisation?.role?.permissions)

    const newRolePolicy: PermissionPolicy = JSON.parse(newRole.permissions)
    const newRoleHasServiceAccountAccess = newRolePolicy.permissions['ServiceAccounts'].length > 0

    if (newRoleHasGlobalAccess && !currentUserHasGlobalAccess) {
      toast.error('You cannot assign users to this role as it requires global access!', {
        autoClose: 5000,
      })
      return false
    }

    if (currentRoleHasGlobalAccess && !currentUserHasGlobalAccess) {
      toast.error("You cannot change this user's role as you don't have global access!", {
        autoClose: 5000,
      })
      return false
    }

    if (newRoleHasGlobalAccess && !userCanReadApps) {
      toast.error(
        'You are missing the required "Apps:read" permissions and cannot assign this user to a role with global access!',
        { autoClose: 5000 }
      )
      return false
    }

    setRole(newRole)

    const processUpdate = async () => {
      return new Promise(async (resolve, reject) => {
        try {
          if (newRoleHasGlobalAccess) await assignGlobalAccess()
          else {
            await updateRole({
              variables: {
                memberId: member.id,
                roleId: newRole.id,
              },
            })
          }
          //if (newRoleHasServiceAccountAccess)
          await updateServiceAccountHandlers(organisation!.id, keyring!)
          resolve(true)
        } catch (error) {
          reject(error)
        }
      })
    }
    await toast.promise(processUpdate, {
      pending: 'Updating role...',
      success: 'Updated role!',
      error: 'Something went wrong!',
    })
  }

  const roleOptions = roleData?.roles.filter((option: RoleType) => option.name !== 'Owner') || []

  const disabled = isOwner || !userCanUpdateMemberRoles || member.self!

  if (roleDataPending) return <></>

  return disabled ? (
    <RoleLabel role={role} />
  ) : (
    <div className="space-y-1 w-full">
      <Listbox disabled={disabled} value={role} onChange={handleUpdateRole}>
        {({ open }) => (
          <>
            <Listbox.Button as={Fragment} aria-required>
              <div
                className={clsx(
                  'py-2 flex items-center justify-between  rounded-md h-10',
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
            <Listbox.Options className="bg-zinc-200 dark:bg-zinc-800 p-2 rounded-md shadow-2xl absolute z-10 w-max focus:outline-none">
              {roleOptions.map((role: RoleType) => (
                <Listbox.Option key={role.name} value={role} as={Fragment}>
                  {({ active, selected }) => (
                    <div
                      className={clsx(
                        'flex items-center gap-2 p-2 cursor-pointer rounded-full',
                        active && 'bg-zinc-300 dark:bg-zinc-700'
                      )}
                    >
                      <RoleLabel role={role} />
                    </div>
                  )}
                </Listbox.Option>
              ))}
            </Listbox.Options>
          </>
        )}
      </Listbox>
    </div>
  )
}

export default function Members({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanInviteMembers = organisation
    ? userHasPermission(organisation.role!.permissions, 'Members', 'create')
    : false

  const userCanReadMembers = organisation
    ? userHasPermission(organisation.role!.permissions, 'Members', 'read')
    : false

  const { data: membersData } = useQuery(GetOrganisationMembers, {
    variables: {
      organisationId: organisation?.id,
      role: null,
    },
    pollInterval: 5000,
    skip: !organisation || !userCanReadMembers,
  })

  const { data: invitesData } = useQuery(GetInvites, {
    variables: {
      orgId: organisation?.id,
    },
    pollInterval: 5000,
    skip: !organisation,
  })

  const [deleteInvite] = useMutation(DeleteOrgInvite)

  const activeUserCanDeleteUsers = organisation?.role?.permissions
    ? userHasPermission(organisation?.role?.permissions, 'Members', 'delete', false)
    : false

  const sortedInvites: OrganisationMemberInviteType[] =
    invitesData?.organisationInvites
      ?.slice() // Create a shallow copy of the array to avoid modifying the original
      .sort((a: OrganisationMemberInviteType, b: OrganisationMemberInviteType) => {
        // Compare the createdAt timestamps in descending order
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      }) || []

  //const activeUserIsAdmin = organisation ? userIsAdmin(organisation.role!) : false

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

  if (!organisation)
    return (
      <div className="flex items-center justify-center p-10">
        <Spinner size="md" />
      </div>
    )

  return (
    <section className="overflow-y-auto h-full">
      <div className="w-full space-y-6 text-black dark:text-white">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{params.team} Members</h2>
          <p className="text-neutral-500">Manage organisation members and roles.</p>
        </div>
        <div className="Space-y-4">
          {userCanInviteMembers && (
            <div className="flex justify-end">
              <InviteDialog organisationId={organisation!.id} />
            </div>
          )}

          {userCanReadMembers ? (
            <table className="table-auto min-w-full divide-y divide-zinc-500/40 ">
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
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-500/20">
                {membersData?.organisationMembers.map((member: OrganisationMemberType) => (
                  <tr key={member.id} className="group">
                    <td className="px-6 py-4 whitespace-nowrap flex items-center gap-2">
                      <Avatar member={member} size="md" />
                      <div>
                        <div className="font-medium">
                          {member.fullName || member.email}
                        </div>
                        {member.fullName && (
                          <div className="text-sm text-gray-500">{member.email}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <RoleLabel role={member.role!} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap capitalize">
                      {relativeTimeFromDates(new Date(member.createdAt))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                       <Link href={`/${params.team}/access/members/${member.id}`}>
                          <Button variant="secondary">
                             Manage <FaChevronRight />
                          </Button>
                       </Link>
                    </td>
                  </tr>
                ))}
                {sortedInvites.map((invite: OrganisationMemberInviteType) => (
                  <tr key={invite.id} className="opacity-60">
                    <td className="px-6 py-4 whitespace-nowrap flex items-center gap-2">
                      <div className="flex rounded-full items-center justify-center h-10 w-10 bg-neutral-500">
                        <FaUserAlt />
                      </div>
                      <div>
                        <div className="font-medium">
                          {invite.inviteeEmail}{' '}
                          <span className="text-sm text-gray-500">
                            (invited by{' '}
                            {invite.invitedBy.self
                              ? 'You'
                              : invite.invitedBy.fullName || invite.invitedBy.email}
                            )
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {invite.role && <RoleLabel role={invite.role} />}
                    </td>
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
                          onClick={() => handleCopy(getInviteLink(invite.id))}
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
          ) : (
            <EmptyState
              title="Access restricted"
              subtitle="You don't have the permissions required to view members in this organisation."
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
      </div>
    </section>
  )
}
