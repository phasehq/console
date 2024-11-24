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
import { GetOrganisationPlan } from '@/graphql/queries/organisation/getOrganisationPlan.gql'
import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useRef, useState } from 'react'
import {
  OrganisationMemberInviteType,
  OrganisationMemberType,
  AppType,
  EnvironmentType,
  ApiOrganisationPlanChoices,
  RoleType,
} from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { relativeTimeFromDates } from '@/utils/time'
import { Dialog, Listbox, Transition } from '@headlessui/react'
import {
  FaBan,
  FaChevronDown,
  FaCopy,
  FaPlus,
  FaTimes,
  FaTrashAlt,
  FaUserAlt,
} from 'react-icons/fa'
import clsx from 'clsx'

import { copyToClipBoard } from '@/utils/clipboard'
import { toast } from 'react-toastify'
import { Avatar } from '@/components/common/Avatar'
import { PermissionPolicy, userHasGlobalAccess, userIsAdmin } from '@/utils/access/permissions'
import { RoleLabel } from '@/components/users/RoleLabel'
import { KeyringContext } from '@/contexts/keyringContext'

import { Alert } from '@/components/common/Alert'
import { Input } from '@/components/common/Input'
import CopyButton from '@/components/common/CopyButton'
import { getInviteLink, unwrapEnvSecretsForUser, wrapEnvSecretsForAccount } from '@/utils/crypto'
import { isCloudHosted } from '@/utils/appConfig'
import { UpsellDialog } from '@/components/settings/organisation/UpsellDialog'
import { useSearchParams } from 'next/navigation'
import { userHasPermission } from '@/utils/access/permissions'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'
import { updateServiceAccountHandlers } from '@/utils/crypto/service-accounts'

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

const InviteDialog = (props: { organisationId: string }) => {
  const { organisationId } = props

  const { activeOrganisation } = useContext(organisationContext)

  const searchParams = useSearchParams()

  const { data } = useQuery(GetOrganisationPlan, {
    variables: { organisationId },
    fetchPolicy: 'cache-and-network',
  })

  const upsell =
    isCloudHosted() &&
    activeOrganisation?.plan === ApiOrganisationPlanChoices.Fr &&
    data?.organisationPlan.seatsUsed.total === data?.organisationPlan.maxUsers

  const [createInvite, { error, loading: mutationLoading }] = useMutation(InviteMember)

  const [isOpen, setIsOpen] = useState<boolean>(false)
  const [email, setEmail] = useState<string>('')

  const emailInputRef = useRef(null)

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
    if (searchParams?.get('invite')) {
      openModal()
    }
  }, [searchParams])

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

    setInviteLink(getInviteLink(data?.inviteOrganisationMember.invite.id))
  }

  if (upsell)
    return (
      <UpsellDialog
        buttonLabel={
          <>
            <FaPlus /> Add a member
          </>
        }
      />
    )

  return (
    <>
      <div className="flex items-center justify-center">
        <Button variant="primary" onClick={openModal} title="Add a member">
          <FaPlus /> Add a member
        </Button>
      </div>

      <Transition appear show={isOpen} as={Fragment}>
        <Dialog
          as="div"
          className="relative z-10"
          onClose={closeModal}
          initialFocus={emailInputRef}
        >
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
                    <p className="text-neutral-500">Invite a user to your Organisation.</p>
                    <div>
                      {!inviteLink && (
                        <form className="space-y-8 py-4" onSubmit={handleInvite}>
                          {errorMessage && (
                            <Alert variant="danger" icon={true}>
                              {errorMessage}
                            </Alert>
                          )}

                          <p className="text-neutral-500">
                            Enter the email address of the user you want to invite below. An
                            invitation link will be sent to this email address.
                          </p>

                          <Alert variant="info" icon={true}>
                            <p>
                              You will need to manually provision access to{' '}
                              <strong> applications </strong> and <strong> environments </strong>{' '}
                              after the member has joined the organization.
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
                              ref={emailInputRef}
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

  const DeleteMemberConfirmDialog = (props: { member: OrganisationMemberType }) => {
    const { member } = props

    const { activeOrganisation: organisation } = useContext(organisationContext)

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

    const allowDelete =
      !member.self! && activeUserCanDeleteUsers && member.role!.name!.toLowerCase() !== 'owner'

    return (
      <>
        {allowDelete && (
          <div className="flex items-center justify-center">
            <Button
              variant="danger"
              onClick={openModal}
              title="Remove member"
              disabled={member.role!.name!.toLowerCase() === 'owner'}
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
                  {activeUserCanDeleteUsers && <th className="px-6 py-3"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-500/40">
                {membersData?.organisationMembers.map((member: OrganisationMemberType) => (
                  <tr key={member.id}>
                    <td className="px-6 py-4 whitespace-nowrap flex items-center gap-2">
                      <Avatar imagePath={member.avatarUrl!} size="lg" />
                      <div className="flex flex-col">
                        <span className="text-lg font-medium">
                          {member.fullName || member.email}
                        </span>
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
                        activeUserCanDeleteUsers &&
                        member.role!.name!.toLowerCase() !== 'owner' && (
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
