'use client'

import { useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useState, useMemo, useEffect } from 'react'
import { OrganisationMemberType, RoleType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { KeyringContext } from '@/contexts/keyringContext'
import { Listbox, Transition, Dialog } from '@headlessui/react'
import { FaChevronDown, FaExchangeAlt, FaExclamationTriangle, FaTimes } from 'react-icons/fa'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { userHasGlobalAccess, userHasPermission } from '@/utils/access/permissions'
import { RoleLabel } from '@/components/users/RoleLabel'
import { Avatar } from '@/components/common/Avatar'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { unwrapEnvSecretsForUser, wrapEnvSecretsForAccount } from '@/utils/crypto'
import { isCloudHosted } from '@/utils/appConfig'
import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import GetApps from '@/graphql/queries/getApps.gql'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { GetEnvironmentKey } from '@/graphql/queries/secrets/getEnvironmentKey.gql'
import UpdateMemberRole from '@/graphql/mutations/organisation/updateOrgMemberRole.gql'
import AddMemberToApp from '@/graphql/mutations/apps/addAppMember.gql'
import TransferOwnership from '@/graphql/mutations/organisation/transferOwnership.gql'
import { GetRoles } from '@/graphql/queries/organisation/getRoles.gql'
import { useLazyQuery } from '@apollo/client'
import { AppType, EnvironmentType } from '@/apollo/graphql'

// Mock role objects for displaying badges
const ownerRole: Partial<RoleType> = { name: 'Owner', permissions: '' }
const adminRole: Partial<RoleType> = { name: 'Admin', permissions: '' }

export const TransferOwnershipSection = () => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { keyring } = useContext(KeyringContext)

  const [isDialogOpen, setIsDialogOpen] = useState(false)

  // Check if current user is owner
  const isOwner = organisation?.role?.name?.toLowerCase() === 'owner'

  // Fetch organization members
  const { data: membersData, loading: membersLoading } = useQuery(GetOrganisationMembers, {
    variables: { organisationId: organisation?.id, role: null },
    skip: !organisation?.id || !isOwner,
  })

  // Filter for global access members (excluding self)
  const globalAccessMembers = useMemo(() => {
    if (!membersData?.organisationMembers) return []
    return membersData.organisationMembers.filter(
      (member: OrganisationMemberType) =>
        userHasGlobalAccess(member.role?.permissions || '') && !member.self
    )
  }, [membersData])

  if (!isOwner) return null

  return (
    <div className="space-y-6 border-t border-neutral-500/40 pt-6">
      <div className="space-y-2">
        <div className="text-lg font-medium py-2 border-b border-neutral-500/20 text-red-500">
          Danger Zone
        </div>
        <p className="text-neutral-500 text-sm">
          Actions in this section are irreversible and should be used with caution.
        </p>
      </div>

      <div className="p-4 rounded-lg ring-1 ring-inset ring-red-500/40 bg-red-500/5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
              Transfer Organisation Ownership
            </h3>
            <p className="text-sm text-neutral-500">
              Transfer ownership of this organisation to another member. This action cannot be
              undone.
            </p>
          </div>
          <Button
            variant="danger"
            onClick={() => setIsDialogOpen(true)}
            disabled={membersLoading || globalAccessMembers.length === 0}
          >
            <FaExchangeAlt />
            Transfer Ownership
          </Button>
        </div>

        {globalAccessMembers.length === 0 && !membersLoading && (
          <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-500/10 p-3 rounded-md">
            <strong>Note:</strong> No eligible members found. Only members with global access (Admin
            role) can become the new owner.
          </div>
        )}
      </div>

      <TransferOwnershipDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        globalAccessMembers={globalAccessMembers}
      />
    </div>
  )
}

const TransferOwnershipDialog = (props: {
  isOpen: boolean
  onClose: () => void
  globalAccessMembers: OrganisationMemberType[]
}) => {
  const { isOpen, onClose, globalAccessMembers } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { keyring } = useContext(KeyringContext)

  const [selectedMember, setSelectedMember] = useState<OrganisationMemberType | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [keysBackedUp, setKeysBackedUp] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [billingEmail, setBillingEmail] = useState('')

  const [transferOwnership, { loading }] = useMutation(TransferOwnership)

  // Update billing email when selected member changes
  useEffect(() => {
    if (selectedMember?.email) {
      setBillingEmail(selectedMember.email)
    }
  }, [selectedMember])

  // Queries for granting global access if needed
  const userCanReadApps = organisation
    ? userHasPermission(organisation.role?.permissions, 'Apps', 'read')
    : false

  const { data: appsData } = useQuery(GetApps, {
    variables: { organisationId: organisation?.id },
    skip: !userCanReadApps || !organisation?.id,
  })

  const { data: roleData } = useQuery(GetRoles, {
    variables: { orgId: organisation?.id },
    skip: !organisation?.id,
  })

  const [getAppEnvs] = useLazyQuery(GetAppEnvironments)
  const [getEnvKey] = useLazyQuery(GetEnvironmentKey)
  const [updateRole] = useMutation(UpdateMemberRole)
  const [addMemberToApp] = useMutation(AddMemberToApp)

  const closeModal = () => {
    setSelectedMember(null)
    setConfirmed(false)
    setKeysBackedUp(false)
    setBillingEmail('')
    onClose()
  }

  /**
   * Assigns global access to a member by wrapping environment keys and updating role to Admin
   */
  const assignGlobalAccess = async (member: OrganisationMemberType): Promise<void> => {
    if (!appsData || !roleData) {
      return Promise.reject(new Error('Required data not available'))
    }

    const apps = appsData.apps

    const processApp = async (app: AppType) => {
      try {
        const { data: appEnvsData } = await getAppEnvs({ variables: { appId: app.id } })
        const appEnvironments = appEnvsData.appEnvironments as EnvironmentType[]

        const envKeyPromises = appEnvironments.map(async (env: EnvironmentType) => {
          const { data } = await getEnvKey({
            variables: { envId: env.id, appId: app.id },
          })

          const { wrappedSeed: userWrappedSeed, wrappedSalt: userWrappedSalt, identityKey } =
            data.environmentKeys[0]

          const { seed, salt } = await unwrapEnvSecretsForUser(
            userWrappedSeed,
            userWrappedSalt,
            keyring!
          )

          const { wrappedSeed, wrappedSalt } = await wrapEnvSecretsForAccount({ seed, salt }, member)

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
      } catch (error) {
        console.error(`Error processing app ${app.id}:`, error)
        throw error
      }
    }

    try {
      for (const app of apps) {
        await processApp(app)
      }

      const adminRole = roleData.roles.find(
        (option: RoleType) => option.name?.toLowerCase() === 'admin'
      )

      if (!adminRole) {
        throw new Error('Admin role not found')
      }

      await updateRole({
        variables: { memberId: member.id, roleId: adminRole.id },
        refetchQueries: [
          {
            query: GetOrganisationMembers,
            variables: { organisationId: organisation?.id, role: null },
          },
        ],
      })
    } catch (error) {
      console.error('Error assigning global access:', error)
      throw error
    }
  }

  const handleTransferOwnership = async () => {
    if (!confirmed || !keysBackedUp || !selectedMember) return

    setIsProcessing(true)

    try {
      // Check if member has global access, if not, grant it first
      const memberHasGlobalAccess = userHasGlobalAccess(selectedMember.role?.permissions || '')

      if (!memberHasGlobalAccess) {
        await toast.promise(assignGlobalAccess(selectedMember), {
          pending: 'Granting global access to member...',
          success: 'Global access granted!',
          error: 'Failed to grant global access',
        })
      }

      // Now transfer ownership
      await transferOwnership({
        variables: {
          organisationId: organisation?.id,
          newOwnerId: selectedMember.id,
          billingEmail: isCloudHosted() ? billingEmail : undefined,
        },
        refetchQueries: [
          {
            query: GetOrganisationMembers,
            variables: { organisationId: organisation?.id, role: null },
          },
        ],
        onCompleted: () => {
          toast.success('Ownership transferred successfully.')
          closeModal()
          setTimeout(() => {
            window.location.href = '/logout'
          }, 2000)
        },
        onError: (error) => {
          toast.error(`Failed to transfer ownership: ${error.message}`)
        },
      })
    } catch (error) {
      console.error('Failed to transfer ownership:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const canTransfer = confirmed && keysBackedUp && selectedMember

  return (
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
                <Dialog.Title as="div" className="flex w-full justify-between gap-2 items-start">
                  <h3 className="text-lg font-medium leading-6 text-zinc-800 dark:text-zinc-200">
                    Transfer Ownership
                  </h3>
                  <Button variant="text" onClick={closeModal}>
                    <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                  </Button>
                </Dialog.Title>

                <div className="space-y-6 py-4">
                  {/* Member Selection */}
                  <div className="space-y-3">
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                      Select new owner
                    </div>
                    <div className="text-sm text-neutral-500 mb-2">
                      Only members with global access can become the organisation owner.
                    </div>
                    <Listbox value={selectedMember} onChange={setSelectedMember}>
                      {({ open }) => (
                        <div className="relative">
                          <Listbox.Button className="relative w-full cursor-pointer rounded-lg bg-zinc-200 dark:bg-zinc-800 py-3 pl-4 pr-10 text-left ring-1 ring-inset ring-neutral-500/20 focus:outline-none focus:ring-2 focus:ring-emerald-500">
                            {selectedMember ? (
                              <div className="flex items-center gap-3">
                                <Avatar member={selectedMember} size="md" />
                                <div className="flex flex-col">
                                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                    {selectedMember.fullName || 'User'}
                                  </span>
                                  <span className="text-neutral-500 text-xs">
                                    {selectedMember.email}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <span className="text-neutral-500">Select a member...</span>
                            )}
                            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                              <FaChevronDown
                                className={clsx(
                                  'transition-transform ease duration-300 text-neutral-500',
                                  open ? 'rotate-180' : 'rotate-0'
                                )}
                              />
                            </span>
                          </Listbox.Button>
                          <Transition
                            as={Fragment}
                            leave="transition ease-in duration-100"
                            leaveFrom="opacity-100"
                            leaveTo="opacity-0"
                          >
                            <Listbox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg bg-zinc-200 dark:bg-zinc-800 py-2 shadow-lg ring-1 ring-black/5 focus:outline-none">
                              {globalAccessMembers.map((member: OrganisationMemberType) => (
                                <Listbox.Option
                                  key={member.id}
                                  value={member}
                                  className={({ active }) =>
                                    clsx(
                                      'relative cursor-pointer select-none py-3 px-4',
                                      active && 'bg-zinc-300 dark:bg-zinc-700'
                                    )
                                  }
                                >
                                  {({ selected }) => (
                                    <div className="flex items-center gap-3">
                                      <Avatar member={member} size="md" />
                                      <div className="flex flex-col flex-1">
                                        <span
                                          className={clsx(
                                            'font-medium text-zinc-900 dark:text-zinc-100',
                                            selected && 'font-semibold'
                                          )}
                                        >
                                          {member.fullName || 'User'}
                                        </span>
                                        <span className="text-neutral-500 text-xs">
                                          {member.email}
                                        </span>
                                      </div>
                                      {member.role && <RoleLabel role={member.role} size="sm" />}
                                    </div>
                                  )}
                                </Listbox.Option>
                              ))}
                            </Listbox.Options>
                          </Transition>
                        </div>
                      )}
                    </Listbox>
                  </div>

                  {selectedMember && (
                    <>
                      {/* What will happen */}
                      <div className="space-y-3">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                          What will happen:
                        </div>
                        <ul className="space-y-3 text-sm text-neutral-500 list-disc pl-5">
                          <li>
                            <span className="flex items-center gap-1.5 flex-wrap">
                              You will lose your current{' '}
                              <RoleLabel role={ownerRole as RoleType} size="sm" /> role and become
                              an <RoleLabel role={adminRole as RoleType} size="sm" />
                            </span>
                          </li>
                          <li>
                            <span className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                                {selectedMember.fullName || selectedMember.email}
                              </span>{' '}
                              will become the new <RoleLabel role={ownerRole as RoleType} size="sm" />
                            </span>
                          </li>
                        </ul>
                      </div>

                      {/* Critical Warning */}
                      <div className="p-4 rounded-lg bg-red-500/10 ring-1 ring-inset ring-red-500/40 space-y-4">
                        <div className="font-semibold text-red-400 flex items-center gap-2">
                          <FaExclamationTriangle />
                          Danger Zone
                        </div>

                        {/* New Owner Card */}
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-200 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/20">
                          <Avatar member={selectedMember} size="lg" />
                          <div className="flex flex-col gap-1">
                            <span className="font-medium text-zinc-900 dark:text-zinc-100">
                              {selectedMember.fullName || 'User'}
                            </span>
                            <span className="text-neutral-500 text-xs">{selectedMember.email}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-neutral-500 text-xs">Current role:</span>
                              {selectedMember.role && (
                                <RoleLabel role={selectedMember.role} size="sm" />
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="text-sm text-neutral-500">
                          When the account ownership transfer is complete, this user&apos;s{' '}
                          <span className="font-semibold text-red-400">account recovery kit</span>{' '}
                          will be the only way to recover access to this organisation.
                        </div>
                      </div>

                      {/* Billing Email - only shown in cloud mode */}
                      {isCloudHosted() && (
                        <div className="space-y-3">
                          <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                            Billing Email
                          </div>
                          <div className="text-sm text-neutral-500 mb-2">
                            This email will be used for billing notifications and invoices.
                          </div>
                          <Input
                            value={billingEmail}
                            setValue={setBillingEmail}
                            placeholder="billing@example.com"
                            type="email"
                          />
                        </div>
                      )}

                      {/* Confirmation Checkboxes */}
                      <div className="space-y-3 border-t border-neutral-500/40 pt-4">
                        <label className="flex items-start gap-3 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={keysBackedUp}
                            onChange={(e) => setKeysBackedUp(e.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-neutral-500/40 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                          />
                          <span className="text-sm text-neutral-500 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition ease">
                            I confirm that{' '}
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                              {selectedMember.fullName || selectedMember.email}
                            </span>{' '}
                            has access to and has backed up their account recovery kit
                          </span>
                        </label>

                        <label className="flex items-start gap-3 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={confirmed}
                            onChange={(e) => setConfirmed(e.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-neutral-500/40 text-emerald-500 focus:ring-emerald-500 cursor-pointer"
                          />
                          <span className="text-sm text-neutral-500 group-hover:text-zinc-700 dark:group-hover:text-zinc-300 transition ease">
                            I understand that I will lose my owner privileges
                          </span>
                        </label>
                      </div>
                    </>
                  )}

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between gap-4 pt-2">
                    <Button variant="secondary" type="button" onClick={closeModal}>
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      onClick={handleTransferOwnership}
                      isLoading={loading || isProcessing}
                      disabled={!canTransfer}
                      icon={FaExchangeAlt}
                    >
                      Transfer Ownership
                    </Button>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
