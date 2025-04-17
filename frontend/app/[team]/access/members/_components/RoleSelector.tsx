'use client'

import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useState } from 'react'
import {
  OrganisationMemberType,
  AppType,
  EnvironmentType,
  RoleType,
} from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { Listbox, Transition } from '@headlessui/react'
import { FaChevronDown } from 'react-icons/fa'
import clsx from 'clsx'

import { toast } from 'react-toastify'
import { PermissionPolicy, userHasGlobalAccess } from '@/utils/access/permissions'
import { RoleLabel } from '@/components/users/RoleLabel'
import { KeyringContext } from '@/contexts/keyringContext'

import { unwrapEnvSecretsForUser, wrapEnvSecretsForAccount } from '@/utils/crypto'
import { userHasPermission } from '@/utils/access/permissions'
import { updateServiceAccountHandlers } from '@/utils/crypto/service-accounts'
import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import GetApps from '@/graphql/queries/getApps.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import DeleteOrgInvite from '@/graphql/mutations/organisation/deleteInvite.gql'
import RemoveMember from '@/graphql/mutations/organisation/deleteOrgMember.gql'
import UpdateMemberRole from '@/graphql/mutations/organisation/updateOrgMemberRole.gql'
import AddMemberToApp from '@/graphql/mutations/apps/addAppMember.gql'
import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'


export const RoleSelector = (props: { member: OrganisationMemberType; organisationId: string; displayOnly?: boolean }) => {
  const { member, organisationId, displayOnly = false } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { keyring } = useContext(KeyringContext)

  const userCanReadApps = userHasPermission(organisation?.role?.permissions, 'Apps', 'read')

  // Permissions required for the dropdown to be interactive
  const userCanUpdateMemberRoles = organisation
    ? userHasPermission(organisation.role!.permissions, 'Members', 'update') &&
      userHasPermission(organisation.role!.permissions, 'Roles', 'read')
    : false

  // We still need role data even if displayOnly, to show the label
  const { data: roleData, loading: roleDataPending } = useQuery(GetRoles, {
    variables: { orgId: organisationId },
    skip: !organisationId,
  })

  // Queries/Mutations only needed if interactive
  const { data: appsData } = useQuery(GetApps, {
    variables: { organisationId: organisationId },
    skip: !userCanReadApps || displayOnly || !userCanUpdateMemberRoles,
  })
  const [getAppEnvs] = useLazyQuery(GetAppEnvironments)
  const [getEnvKey] = useLazyQuery(GetEnvironmentKey)
  const [updateRole] = useMutation(UpdateMemberRole)
  const [addMemberToApp] = useMutation(AddMemberToApp)

  // Use member.role directly if it exists, otherwise initialize useState
  const [role, setRole] = useState<RoleType | undefined | null>(member.role)

  // Update local role state if member prop changes (e.g., after mutation refetch)
  useEffect(() => {
    setRole(member.role)
  }, [member.role])

  const isOwner = role?.name?.toLowerCase() === 'owner'

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

      // Find the admin role (assuming it exists and is named 'Admin')
      const adminRole = roleOptions.find(
        (option: RoleType) => option.name?.toLowerCase() === 'admin'
      )

      if (!adminRole) {
        throw new Error('Admin role not found')
      }
      
       // After all apps have been processed, assign the admin role
      await updateRole({
        variables: {
          memberId: member.id,
          roleId: adminRole.id,
        },
         refetchQueries: [
           { query: GetOrganisationMembers, variables: { organisationId: organisationId, role: null } },
         ]
      })

    } catch (error) {
      console.error('Error assigning global access:', error)
      throw error // Ensure the promise rejects if any error occurs
    }
  }

  const handleUpdateRole = async (newRole: RoleType) => {
    if (!role) return; // Should not happen if rendered

    const currentRoleHasGlobalAccess = userHasGlobalAccess(role?.permissions)
    const newRoleHasGlobalAccess = userHasGlobalAccess(newRole.permissions)
    const currentUserHasGlobalAccess = userHasGlobalAccess(organisation?.role?.permissions)

    const newRolePolicy: PermissionPolicy = JSON.parse(newRole.permissions)
    const newRoleHasServiceAccountAccess = newRolePolicy.permissions['ServiceAccounts']?.length > 0 // Optional chaining for safety

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

    setRole(newRole) // Optimistic UI update

    const processUpdate = async () => {
       return new Promise(async (resolve, reject) => {
         try {
           if (newRoleHasGlobalAccess) {
             await assignGlobalAccess() // This function now also calls updateRole internally
           } else {
             await updateRole({
               variables: {
                 memberId: member.id,
                 roleId: newRole.id,
               },
               refetchQueries: [
                  { query: GetOrganisationMembers, variables: { organisationId: organisationId, role: null } },
                ]
             })
           }
           // Update Service Account handlers if the new role grants access
           // Consider if this should only run if access *changes*
           if (newRoleHasServiceAccountAccess) {
             await updateServiceAccountHandlers(organisationId, keyring!)
           }
           resolve(true)
         } catch (error) {
           setRole(member.role ?? undefined) // Revert optimistic update on error, handle null
           reject(error)
         }
       })
     }

     await toast.promise(processUpdate(), {
       pending: 'Updating role...',
       success: 'Updated role!',
       error: 'Failed to update role!', // Provide a more specific error message if possible from the catch block
     })
  }

  const roleOptions = roleData?.roles.filter((option: RoleType) => option.name?.toLowerCase() !== 'owner') || []

  // Determine if the selector should be disabled
  const disabled = !!(displayOnly || isOwner || !userCanUpdateMemberRoles || member.self)

  if (roleDataPending) return <div className="h-10 w-24 bg-neutral-500/20 animate-pulse rounded-full" /> // Skeleton loader

  if (!role) return <div className="text-neutral-500">No role assigned</div> // Handle case where role is null/undefined

  // Always render RoleLabel if disabled or if it's the owner
  if (disabled || isOwner) {
    return <RoleLabel role={role} />
  }

  // Render interactive Listbox otherwise
  return (
    <div className="space-y-1 w-full">
      <Listbox disabled={disabled} value={role} onChange={handleUpdateRole}>
        {({ open }) => (
          <>
            <Listbox.Button as={Fragment} aria-required>
              <div
                className={clsx(
                  'py-2 flex items-center justify-between rounded-md h-10',
                  disabled ? 'cursor-not-allowed' : 'cursor-pointer',
                  'hover:bg-neutral-500/10 px-2' // Add some hover effect and padding
                )}
              >
                <RoleLabel role={role!} />
                {!disabled && (
                  <FaChevronDown
                    className={clsx(
                      'transition-transform ease duration-300 text-neutral-500 ml-2',
                      open ? 'rotate-180' : 'rotate-0'
                    )}
                  />
                )}
              </div>
            </Listbox.Button>
            <Transition
               as={Fragment}
               leave="transition ease-in duration-100"
               leaveFrom="opacity-100"
               leaveTo="opacity-0"
             >
              <Listbox.Options className="bg-zinc-200 dark:bg-zinc-800 p-2 rounded-md shadow-2xl absolute z-10 w-max focus:outline-none mt-1">
                {roleOptions.map((optionRole: RoleType) => (
                  <Listbox.Option key={optionRole.id} value={optionRole} as={Fragment}>
                    {({ active, selected }) => (
                      <div
                        className={clsx(
                          'flex items-center gap-2 p-2 cursor-pointer rounded-full',
                          active && 'bg-zinc-300 dark:bg-zinc-700',
                          selected && 'font-semibold' // Indicate selected
                        )}
                      >
                        <RoleLabel role={optionRole} />
                      </div>
                    )}
                  </Listbox.Option>
                ))}
              </Listbox.Options>
             </Transition>
          </>
        )}
      </Listbox>
    </div>
  )
} 