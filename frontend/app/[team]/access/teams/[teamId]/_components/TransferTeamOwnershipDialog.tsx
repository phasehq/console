'use client'

import { TeamMembershipType, TeamType } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { Button } from '@/components/common/Button'
import { ProfileCard } from '@/components/common/ProfileCard'
import { RoleLabel } from '@/components/users/RoleLabel'
import { organisationContext } from '@/contexts/organisationContext'
import { GetTeams } from '@/graphql/queries/teams/getTeams.gql'
import { TransferTeamOwnershipOp } from '@/graphql/mutations/teams/transferTeamOwnership.gql'
import { useMutation } from '@apollo/client'
import { useContext, useRef, useState } from 'react'
import { FaCheck, FaCrown, FaExchangeAlt, FaSearch, FaTimesCircle } from 'react-icons/fa'
import clsx from 'clsx'
import { toast } from 'react-toastify'

export const TransferTeamOwnershipDialog = ({ team }: { team: TeamType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const [transferOwnership, { loading }] = useMutation(TransferTeamOwnershipOp)
  const dialogRef = useRef<{ closeModal: () => void }>(null)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const humanMembers = (team.members || []).filter(
    (m): m is TeamMembershipType & { orgMember: NonNullable<TeamMembershipType['orgMember']> } =>
      !!m.orgMember && m.orgMember.id !== team.owner?.id
  )

  const filteredMembers =
    searchQuery !== ''
      ? humanMembers.filter((m) => {
          const q = searchQuery.toLowerCase()
          return (
            m.orgMember.fullName?.toLowerCase().includes(q) ||
            m.orgMember.email?.toLowerCase().includes(q)
          )
        })
      : humanMembers

  const handleTransfer = async () => {
    if (!selectedMemberId) return
    try {
      await transferOwnership({
        variables: { teamId: team.id, newOwnerId: selectedMemberId },
        refetchQueries: [
          {
            query: GetTeams,
            variables: { organisationId: organisation!.id, teamId: team.id },
          },
        ],
      })
      const newOwner = humanMembers.find((m) => m.orgMember.id === selectedMemberId)
      toast.success(
        `Transferred ownership to ${newOwner?.orgMember.fullName || newOwner?.orgMember.email || 'member'}`
      )
      setSelectedMemberId(null)
      setSearchQuery('')
      dialogRef.current?.closeModal()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  return (
    <GenericDialog
      title="Transfer team ownership"
      buttonContent={
        <>
          <FaExchangeAlt /> {team.owner ? 'Transfer Ownership' : 'Set Owner'}
        </>
      }
      buttonVariant="danger"
      ref={dialogRef}
      onClose={() => {
        setSelectedMemberId(null)
        setSearchQuery('')
      }}
    >
      <div className="space-y-3 pt-4">
        <p className="text-sm text-neutral-500">
          {team.owner
            ? 'Select a team member to transfer ownership to. The new owner will have full control over this team.'
            : 'This team has no owner. Select a team member to assign as owner.'}
        </p>

        <div className="relative flex items-center bg-zinc-200 dark:bg-zinc-800 rounded-md px-2">
          <FaSearch className="text-neutral-500 text-xs shrink-0" />
          <input
            placeholder="Search members"
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

        <div className="max-h-[60vh] overflow-y-auto space-y-1">
          {filteredMembers.length === 0 ? (
            <p className="text-xs text-neutral-500 text-center py-4">
              {humanMembers.length === 0
                ? 'No other team members available to transfer ownership to. Add members to the team first.'
                : 'No members match your search'}
            </p>
          ) : (
            filteredMembers.map((membership) => {
              const isCurrentOwner = team.owner?.id === membership.orgMember.id
              const isSelected = selectedMemberId === membership.orgMember.id

              return (
                <div
                  key={membership.id}
                  className={clsx(
                    'group p-2 rounded-md transition',
                    isCurrentOwner
                      ? 'opacity-50 cursor-not-allowed'
                      : isSelected
                        ? 'bg-emerald-500/10 cursor-pointer'
                        : 'hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer'
                  )}
                  onClick={() => {
                    if (!isCurrentOwner) setSelectedMemberId(membership.orgMember.id)
                  }}
                >
                  <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 w-full">
                    <ProfileCard
                      member={membership.orgMember}
                      size="md"
                    />
                    <div>
                      {membership.orgMember.role && (
                        <RoleLabel role={membership.orgMember.role} size="xs" />
                      )}
                    </div>
                    <div className="w-6 flex justify-center">
                      {isCurrentOwner ? (
                        <span
                          className="text-2xs text-amber-500 flex items-center gap-1"
                          title="Current owner"
                        >
                          <FaCrown />
                        </span>
                      ) : (
                        <div
                          className={clsx(
                            'w-5 h-5 rounded-full border flex items-center justify-center transition',
                            isSelected
                              ? 'bg-emerald-500 border-emerald-500 text-white'
                              : 'border-neutral-400 dark:border-neutral-600 text-neutral-400 dark:text-neutral-600 opacity-0 group-hover:opacity-100'
                          )}
                        >
                          <FaCheck className="text-[0.6rem]" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="primary"
            onClick={handleTransfer}
            isLoading={loading}
            disabled={!selectedMemberId}
          >
            {team.owner ? 'Transfer Ownership' : 'Set Owner'}
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}
