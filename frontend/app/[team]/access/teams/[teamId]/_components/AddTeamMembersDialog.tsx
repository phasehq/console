'use client'

import { OrganisationMemberType, ServiceAccountType, TeamMembershipType } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { Button } from '@/components/common/Button'
import { Checkbox } from '@/components/common/Checkbox'
import { ProfileCard } from '@/components/common/ProfileCard'
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
import { Alert } from '@/components/common/Alert'

export const AddTeamMembersDialog = ({
  teamId,
  existingMembers,
  mode = 'all',
  buttonVariant = 'primary',
}: {
  teamId: string
  existingMembers: TeamMembershipType[]
  mode?: 'all' | 'members' | 'service-accounts'
  buttonVariant?: 'primary' | 'secondary'
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
      (sa: ServiceAccountType) => !existingSaIds.has(sa.id) && !sa.team
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
      ? availableSAs.filter((sa) => sa.name?.toLowerCase().includes(searchQuery.toLowerCase()))
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

  const totalSelected =
    (mode === 'service-accounts' ? 0 : selectedMembers.size) +
    (mode === 'members' ? 0 : selectedSAs.size)

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
        parts.push(`${selectedSAs.size} service account${selectedSAs.size !== 1 ? 's' : ''}`)
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
    if (mode !== 'service-accounts' && selectedMembers.size > 0)
      parts.push(`${selectedMembers.size} member${selectedMembers.size !== 1 ? 's' : ''}`)
    if (mode !== 'members' && selectedSAs.size > 0)
      parts.push(`${selectedSAs.size} service account${selectedSAs.size !== 1 ? 's' : ''}`)
    return parts.length > 0 ? parts.join(', ') : '0 selected'
  }

  const dialogTitle =
    mode === 'members'
      ? 'Add members to team'
      : mode === 'service-accounts'
        ? 'Add service accounts to team'
        : 'Add members to team'

  const buttonLabel =
    mode === 'members'
      ? 'Add Members'
      : mode === 'service-accounts'
        ? 'Add Service Accounts'
        : 'Add Members'

  const searchBar = (
    <div className="relative flex items-center bg-zinc-200 dark:bg-zinc-800 rounded-md px-2">
      <FaSearch className="text-neutral-500 text-xs shrink-0" />
      <input
        placeholder={
          mode === 'service-accounts'
            ? 'Search service accounts'
            : mode === 'members'
              ? 'Search members'
              : 'Search accounts'
        }
        className="custom bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder:text-neutral-500 w-full text-xs py-1.5"
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
  )

  const membersList = (
    <div className="max-h-[60vh] overflow-y-auto divide-y divide-zinc-500/20 pr-2">
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
            <ProfileCard member={member} size="md" />
            <Checkbox
              size="sm"
              checked={selectedMembers.has(member.id)}
              onChange={() => toggleMember(member.id)}
            />
          </div>
        ))
      )}
    </div>
  )

  const saList = (
    <div className="max-h-[60vh] overflow-y-auto divide-y divide-zinc-500/20 pr-2">
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
            <ProfileCard serviceAccount={sa} size="md" />
            <Checkbox
              size="sm"
              checked={selectedSAs.has(sa.id)}
              onChange={() => toggleSA(sa.id)}
            />
          </div>
        ))
      )}
    </div>
  )

  return (
    <GenericDialog
      title={dialogTitle}
      buttonContent={
        <>
          <FaPlus /> {buttonLabel}
        </>
      }
      buttonVariant={buttonVariant}
      ref={dialogRef}
      onClose={reset}
    >
      <div className="space-y-3 pt-4">
        {mode === 'all' ? (
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

            {searchBar}

            <Tab.Panels>
              <Tab.Panel>{membersList}</Tab.Panel>
              <Tab.Panel>{saList}</Tab.Panel>
            </Tab.Panels>
          </Tab.Group>
        ) : (
          <>
            {mode === 'service-accounts' && (
              <Alert variant="warning" icon size="sm">
                These accounts can be managed by other teams or users outside this team.
              </Alert>
            )}
            {searchBar}
            {mode === 'members' ? membersList : saList}
          </>
        )}

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
