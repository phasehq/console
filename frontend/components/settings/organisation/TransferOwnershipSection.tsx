'use client'

import { useMutation } from '@apollo/client'
import { useRouter } from 'next/navigation'
import { Fragment, useContext, useState, useMemo, useEffect } from 'react'
import { OrganisationMemberType, RoleType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { Combobox, Transition, Dialog } from '@headlessui/react'
import { FaChevronDown, FaTimes } from 'react-icons/fa'
import { HiBuildingOffice2 } from 'react-icons/hi2'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { userHasGlobalAccess } from '@/utils/access/permissions'
import { RoleLabel } from '@/components/users/RoleLabel'
import { Avatar } from '@/components/common/Avatar'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { Checkbox } from '@/components/common/Checkbox'
import { Input } from '@/components/common/Input'
import { isCloudHosted } from '@/utils/appConfig'
import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import TransferOwnership from '@/graphql/mutations/organisation/transferOwnership.gql'
import { useLazyQuery } from '@apollo/client'

// Mock role objects for displaying badges
const ownerRole: Partial<RoleType> = { name: 'Owner', permissions: '' }
const adminRole: Partial<RoleType> = { name: 'Admin', permissions: '' }

export const TransferOwnershipSection = () => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const [isDialogOpen, setIsDialogOpen] = useState(false)

  // Check if current user is owner
  const isOwner = organisation?.role?.name?.toLowerCase() === 'owner'

  if (!isOwner) return null

  return (
    <div className="space-y-6 border-t border-neutral-500/40 pt-6">
      <div className="border-b border-neutral-500/20 pb-2">
        <div className="text-lg font-medium py-2 text-red-500">
          Danger Zone
        </div>
        <div className="text-neutral-500">
          Proceed with caution. These actions may have unintended consequences.
        </div>
      </div>

      <div className="p-4 py-6 rounded-lg ring-1 ring-inset ring-red-500/40 bg-red-500/5">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="font-medium text-zinc-900 dark:text-zinc-100">
              Transfer Organisation Ownership
            </h3>
            <p className="text-sm text-neutral-500">
              Transfer ownership of this organisation to another member.
            </p>
          </div>
          <Button
            variant="danger"
            onClick={() => setIsDialogOpen(true)}
          >
            <HiBuildingOffice2 />
            Transfer Ownership
          </Button>
        </div>
      </div>

      <TransferOwnershipDialog
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
      />
    </div>
  )
}

const TransferOwnershipDialog = (props: {
  isOpen: boolean
  onClose: () => void
}) => {
  const { isOpen, onClose } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)
  const router = useRouter()

  const [fetchMembers, { data: membersData }] = useLazyQuery(GetOrganisationMembers, {
    fetchPolicy: 'network-only',
  })

  useEffect(() => {
    if (isOpen && organisation?.id) {
      fetchMembers({ variables: { organisationId: organisation.id, role: null } })
    }
  }, [isOpen, organisation?.id, fetchMembers])

  const globalAccessMembers = useMemo(() => {
    if (!membersData?.organisationMembers) return []
    return membersData.organisationMembers.filter(
      (member: OrganisationMemberType) =>
        userHasGlobalAccess(member.role?.permissions || '') && !member.self
    )
  }, [membersData])

  const [step, setStep] = useState<1 | 2>(1)
  const [selectedMember, setSelectedMember] = useState<OrganisationMemberType | null>(null)
  const [query, setQuery] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [keysBackedUp, setKeysBackedUp] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [billingEmail, setBillingEmail] = useState('')

  const filteredMembers =
    query === ''
      ? globalAccessMembers
      : globalAccessMembers.filter((member: OrganisationMemberType) => {
          const q = query.toLowerCase()
          return (
            member.fullName?.toLowerCase().includes(q) ||
            member.email?.toLowerCase().includes(q)
          )
        })

  const [transferOwnership, { loading }] = useMutation(TransferOwnership)

  // Update billing email when selected member changes
  useEffect(() => {
    if (selectedMember?.email) {
      setBillingEmail(selectedMember.email)
    }
  }, [selectedMember])

  const closeModal = () => {
    setStep(1)
    setSelectedMember(null)
    setQuery('')
    setConfirmed(false)
    setKeysBackedUp(false)
    setBillingEmail('')
    onClose()
  }

  const goBack = () => {
    setStep(1)
    setConfirmed(false)
    setKeysBackedUp(false)
  }

  const handleTransferOwnership = async () => {
    if (!confirmed || !keysBackedUp || !selectedMember) return

    setIsProcessing(true)

    try {
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
          // Redirect to the members page so the user can verify role changes
          window.location.href = `/${organisation?.name}/access/members`
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
                    {step === 1 ? 'Transfer Ownership' : `Transfer ownership of ${organisation?.name}`} to
                  </h3>
                  <Button variant="text" onClick={closeModal}>
                    <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                  </Button>
                </Dialog.Title>

                {/* Step 1: Select a member */}
                {step === 1 && (
                  <div className="space-y-6 py-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-1.5 font-semibold text-zinc-900 dark:text-zinc-100">
                        Select a new <RoleLabel role={ownerRole as RoleType} size="sm" />
                      </div>
                      <p className="text-sm text-neutral-500">
                        Only{' '}
                        <RoleLabel role={adminRole as RoleType} size="sm" />{' '}
                        members can be made the organisation owner. You can set a member&apos;s role
                        to Admin from{' '}
                        <a
                          href={`/${organisation?.name}/access/members`}
                          className="text-emerald-500 hover:underline"
                        >
                          Access Control
                        </a>
                        .{' '}
                      </p>

                      <Combobox as="div" className="relative" value={selectedMember} onChange={setSelectedMember}>
                        {({ open }) => (
                          <>
                            <div className="w-full relative flex items-center">
                              <Combobox.Input
                                className="w-full"
                                onChange={(event) => setQuery(event.target.value)}
                                displayValue={(member: OrganisationMemberType | null) =>
                                  member ? member.fullName || member.email || '' : ''
                                }
                                placeholder="Search for a member..."
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
                            <Transition
                              enter="transition duration-100 ease-out"
                              enterFrom="transform scale-95 opacity-0"
                              enterTo="transform scale-100 opacity-100"
                              leave="transition duration-75 ease-out"
                              leaveFrom="transform scale-100 opacity-100"
                              leaveTo="transform scale-95 opacity-0"
                            >
                              <Combobox.Options as={Fragment}>
                                <div className="bg-zinc-200 dark:bg-zinc-800 p-2 rounded-b-md shadow-2xl z-20 absolute max-h-60 overflow-y-auto w-full border border-t-0 border-neutral-500/20">
                                  {filteredMembers.length === 0 ? (
                                    <div className="p-2 text-neutral-500 text-sm">
                                      No eligible members found
                                    </div>
                                  ) : (
                                    filteredMembers.map((member: OrganisationMemberType) => (
                                      <Combobox.Option as="div" key={member.id} value={member}>
                                        {({ active, selected }) => (
                                          <div
                                            className={clsx(
                                              'flex items-center gap-2 p-2 cursor-pointer w-full rounded-md',
                                              active && 'bg-zinc-300 dark:bg-zinc-700'
                                            )}
                                          >
                                            <Avatar member={member} size="sm" />
                                            <div className="flex flex-col flex-1 min-w-0">
                                              <span
                                                className={clsx(
                                                  'text-sm text-zinc-900 dark:text-zinc-100 truncate',
                                                  selected && 'font-semibold'
                                                )}
                                              >
                                                {member.fullName || 'User'}
                                              </span>
                                              <span className="text-neutral-500 text-2xs truncate">
                                                {member.email}
                                              </span>
                                            </div>
                                          </div>
                                        )}
                                      </Combobox.Option>
                                    ))
                                  )}
                                </div>
                              </Combobox.Options>
                            </Transition>
                          </>
                        )}
                      </Combobox>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between gap-4 pt-2">
                      <Button variant="secondary" type="button" onClick={closeModal}>
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => setStep(2)}
                        disabled={!selectedMember}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}

                {/* Step 2: Confirm transfer */}
                {step === 2 && selectedMember && (
                  <div className="space-y-6 py-4">
                    {/* Selected User Card */}
                    <div className="flex items-center gap-3 p-4 rounded-lg bg-zinc-200 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/20">
                      <Avatar member={selectedMember} size="lg" />
                      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {selectedMember.fullName || 'User'}
                        </span>
                        <span className="text-neutral-500 text-sm">{selectedMember.email}</span>
                      </div>
                    </div>

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
                            </span>
                            {selectedMember.fullName && (
                              <span className="text-neutral-500">({selectedMember.email})</span>
                            )}{' '}
                            will become the new <RoleLabel role={ownerRole as RoleType} size="sm" />
                          </span>
                        </li>
                      </ul>
                    </div>

                    {/* Critical Warning */}
                    <Alert variant="danger" icon>
                      <span className="text-sm">
                        When the ownership transfer is complete, the new owner&apos;s{' '}
                        <span className="font-semibold">account recovery kit</span>{' '}
                        will be the only way to recover access to this organisation.
                      </span>
                    </Alert>

                    {/* Billing Email - only shown in cloud mode */}
                    {isCloudHosted() && (
                      <div className="space-y-3">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                          New Billing Email
                        </div>
                        <div className="text-sm text-neutral-500">
                          This email will be used for your organisation&apos;s billing related
                          notifications, given the owner is primarily responsible for billing. You can change this later.
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
                    <div className="space-y-4 border-t border-neutral-500/40 pt-4">
                      <Checkbox
                        checked={keysBackedUp}
                        onChange={setKeysBackedUp}
                        size="sm"
                        label={`I confirm that ${selectedMember.fullName || selectedMember.email} has access to and has backed up their account recovery kit`}
                      />

                      <Checkbox
                        checked={confirmed}
                        onChange={setConfirmed}
                        size="sm"
                        label="I understand that I will lose my owner privileges"
                      />
                    </div>

                    {/* Action Buttons */}
                    <div className="flex items-center justify-between gap-4 pt-2">
                      <Button variant="secondary" type="button" onClick={goBack}>
                        Back
                      </Button>
                      <Button
                        variant="danger"
                        onClick={handleTransferOwnership}
                        isLoading={loading || isProcessing}
                        disabled={!canTransfer}
                      >
                        Transfer Ownership
                      </Button>
                    </div>
                  </div>
                )}
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
