'use client'

import {
  OrganisationMemberType,
  ServiceAccountType,
  TeamMembershipType,
} from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { Button } from '@/components/common/Button'
import { Avatar } from '@/components/common/Avatar'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { organisationContext } from '@/contexts/organisationContext'
import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import { GetServiceAccounts } from '@/graphql/queries/service-accounts/getServiceAccounts.gql'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { AddTeamMembersOp } from '@/graphql/mutations/teams/addTeamMembers.gql'
import { useApolloClient, useMutation, useQuery } from '@apollo/client'
import { useContext, useRef, useState } from 'react'
import { FaPlus, FaSearch, FaTimesCircle, FaUsers, FaRobot } from 'react-icons/fa'
import clsx from 'clsx'
import { toast } from 'react-toastify'
import { Tab } from '@headlessui/react'

export const AddTeamMembersDialog = ({
  teamId,
  existingMembers,
}: {
  teamId: string
  existingMembers: TeamMembershipType[]
}) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data: membersData } = useQuery(GetOrganisationMembers, {
    variables: { organisationId: organisation?.id, role: null },
    skip: !organisation,
  })

  const { data: saData } = useQuery(GetServiceAccounts, {
    variables: { orgId: organisation?.id },
    skip: !organisation,
  })

  const client = useApolloClient()
  const [addMembers, { loading }] = useMutation(AddTeamMembersOp)

  const dialogRef = useRef<{ closeModal: () => void }>(null)
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set())
  const [selectedSAs, setSelectedSAs] = useState<Set<string>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')

  const existingMemberIds = new Set(
    existingMembers.filter((m) => m.orgMember).map((m) => m.orgMember!.id)
  )

  const existingSaIds = new Set(
    existingMembers.filter((m) => m.serviceAccount).map((m) => m.serviceAccount!.id)
  )

  const availableMembers: OrganisationMemberType[] =
    membersData?.organisationMembers?.filter(
      (m: OrganisationMemberType) => !existingMemberIds.has(m.id)
    ) || []

  const availableSAs: ServiceAccountType[] =
    saData?.serviceAccounts?.filter(
      (sa: ServiceAccountType) => !existingSaIds.has(sa.id)
    ) || []

  const filteredMembers =
    searchQuery !== ''
      ? availableMembers.filter(
          (m) =>
            m.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.email?.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : availableMembers

  const filteredSAs =
    searchQuery !== ''
      ? availableSAs.filter((sa) =>
          sa.name?.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : availableSAs

  const toggleMember = (id: string) => {
    setSelectedMembers((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSA = (id: string) => {
    setSelectedSAs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const totalSelected = selectedMembers.size + selectedSAs.size

  const handleSubmit = async () => {
    if (totalSelected === 0) return
    try {
      const promises: Promise<any>[] = []

      if (selectedMembers.size > 0) {
        promises.push(
          addMembers({
            variables: {
              teamId,
              memberIds: Array.from(selectedMembers),
              memberType: 'USER',
            },
          })
        )
      }

      if (selectedSAs.size > 0) {
        promises.push(
          addMembers({
            variables: {
              teamId,
              memberIds: Array.from(selectedSAs),
              memberType: 'SERVICE',
            },
          })
        )
      }

      await Promise.all(promises)

      await client.refetchQueries({
        include: [GetTeams],
      })

      const parts: string[] = []
      if (selectedMembers.size > 0)
        parts.push(`${selectedMembers.size} member${selectedMembers.size !== 1 ? 's' : ''}`)
      if (selectedSAs.size > 0)
        parts.push(
          `${selectedSAs.size} service account${selectedSAs.size !== 1 ? 's' : ''}`
        )
      toast.success(`Added ${parts.join(' and ')} to team`)
      reset()
      dialogRef.current?.closeModal()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  const reset = () => {
    setSelectedMembers(new Set())
    setSelectedSAs(new Set())
    setSearchQuery('')
  }

  const selectedSummary = () => {
    const parts: string[] = []
    if (selectedMembers.size > 0)
      parts.push(`${selectedMembers.size} member${selectedMembers.size !== 1 ? 's' : ''}`)
    if (selectedSAs.size > 0)
      parts.push(`${selectedSAs.size} SA${selectedSAs.size !== 1 ? 's' : ''}`)
    return parts.length > 0 ? parts.join(', ') : '0 selected'
  }

  return (
    <GenericDialog
      title="Add members to team"
      buttonContent={
        <>
          <FaPlus /> Add Members
        </>
      }
      buttonVariant="primary"
      ref={dialogRef}
      onClose={reset}
    >
      <div className="space-y-3 pt-4">
        <Tab.Group
          onChange={() => {
            setSearchQuery('')
          }}
        >
          <Tab.List className="flex gap-2 w-full border-b border-neutral-500/20">
            <Tab
              className={({ selected }) =>
                clsx(
                  'p-2 text-xs font-medium border-b -mb-px focus:outline-none transition ease flex items-center gap-1.5',
                  selected
                    ? 'border-emerald-500 font-semibold text-zinc-900 dark:text-zinc-100'
                    : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                )
              }
            >
              <FaUsers className="text-xs" /> Members
              {selectedMembers.size > 0 && (
                <span className="text-2xs px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-500">
                  {selectedMembers.size}
                </span>
              )}
            </Tab>
            <Tab
              className={({ selected }) =>
                clsx(
                  'p-2 text-xs font-medium border-b -mb-px focus:outline-none transition ease flex items-center gap-1.5',
                  selected
                    ? 'border-emerald-500 font-semibold text-zinc-900 dark:text-zinc-100'
                    : 'border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
                )
              }
            >
              <FaRobot className="text-xs" /> Service Accounts
              {selectedSAs.size > 0 && (
                <span className="text-2xs px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-500">
                  {selectedSAs.size}
                </span>
              )}
            </Tab>
          </Tab.List>

          <div className="relative flex items-center bg-zinc-100 dark:bg-zinc-800 rounded-md px-2">
            <FaSearch className="text-neutral-500 text-xs shrink-0" />
            <input
              placeholder="Search accounts"
              className="custom bg-zinc-100 dark:bg-zinc-800 placeholder:text-neutral-500 w-full text-xs py-1.5"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <FaTimesCircle
              className={clsx(
                'cursor-pointer text-neutral-500 transition-opacity ease absolute right-2 text-xs',
                searchQuery ? 'opacity-100' : 'opacity-0'
              )}
              role="button"
              onClick={() => setSearchQuery('')}
            />
          </div>

          <Tab.Panels>
            <Tab.Panel className="max-h-80 overflow-y-auto divide-y divide-zinc-500/20">
              {filteredMembers.length === 0 ? (
                <p className="text-xs text-neutral-500 text-center py-4">
                  {availableMembers.length === 0
                    ? 'All organisation members are already in this team'
                    : 'No members match your search'}
                </p>
              ) : (
                filteredMembers.map((member: OrganisationMemberType) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between py-1 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 px-2 rounded"
                    onClick={() => toggleMember(member.id)}
                  >
                    <div className="flex items-center gap-2">
                      <Avatar member={member} size="md" />
                      <div>
                        <div className="text-xs font-medium">
                          {member.fullName || member.email}
                        </div>
                        {member.fullName && (
                          <div className="text-2xs text-neutral-500">{member.email}</div>
                        )}
                      </div>
                    </div>
                    <ToggleSwitch
                      size="sm"
                      value={selectedMembers.has(member.id)}
                      onToggle={() => toggleMember(member.id)}
                    />
                  </div>
                ))
              )}
            </Tab.Panel>
            <Tab.Panel className="max-h-80 overflow-y-auto divide-y divide-zinc-500/20">
              {filteredSAs.length === 0 ? (
                <p className="text-xs text-neutral-500 text-center py-4">
                  {availableSAs.length === 0
                    ? 'All service accounts are already in this team'
                    : 'No service accounts match your search'}
                </p>
              ) : (
                filteredSAs.map((sa: ServiceAccountType) => (
                  <div
                    key={sa.id}
                    className="flex items-center justify-between py-1 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 px-2 rounded"
                    onClick={() => toggleSA(sa.id)}
                  >
                    <div className="flex items-center gap-2">
                      <Avatar serviceAccount={sa} size="md" />
                      <div>
                        <div className="text-xs font-medium">{sa.name}</div>
                        <div className="text-2xs text-neutral-500 font-mono">{sa.id}</div>
                      </div>
                    </div>
                    <ToggleSwitch
                      size="sm"
                      value={selectedSAs.has(sa.id)}
                      onToggle={() => toggleSA(sa.id)}
                    />
                  </div>
                ))
              )}
            </Tab.Panel>
          </Tab.Panels>
        </Tab.Group>

        <div className="flex justify-between items-center">
          <span className="text-2xs text-neutral-500">{selectedSummary()}</span>
          <Button
            variant="primary"
            onClick={handleSubmit}
            isLoading={loading}
            disabled={totalSelected === 0}
          >
            Add to Team
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
