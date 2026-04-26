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
import { FaCrown } from 'react-icons/fa'
import clsx from 'clsx'
import { toast } from 'react-toastify'

export const TransferTeamOwnershipDialog = ({ team }: { team: TeamType }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const [transferOwnership, { loading }] = useMutation(TransferTeamOwnershipOp)
  const dialogRef = useRef<{ closeModal: () => void }>(null)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)

  const humanMembers = (team.members || []).filter(
    (m): m is TeamMembershipType & { orgMember: NonNullable<TeamMembershipType['orgMember']> } =>
      !!m.orgMember
  )

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
          <FaCrown /> {team.owner ? 'Transfer ownership' : 'Set owner'}
        </>
      }
      buttonVariant="secondary"
      ref={dialogRef}
      onClose={() => setSelectedMemberId(null)}
    >
      <div className="space-y-4 pt-4">
        <p className="text-sm text-neutral-500">
          {team.owner
            ? 'Select a team member to transfer ownership to. The new owner will have full control over this team.'
            : 'This team has no owner. Select a team member to assign as owner.'}
        </p>

        <div className="max-h-[60vh] overflow-y-auto space-y-1">
          {humanMembers.map((membership) => {
            const isCurrentOwner = team.owner?.id === membership.orgMember.id
            const isSelected = selectedMemberId === membership.orgMember.id

            return (
              <div
                key={membership.id}
                className={clsx(
                  'p-2 rounded-lg cursor-pointer transition',
                  isCurrentOwner
                    ? 'opacity-50 cursor-not-allowed'
                    : isSelected
                      ? 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/30'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'
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
                  <div>
                    {isCurrentOwner && (
                      <span className="text-2xs text-amber-500 flex items-center gap-1">
                        <FaCrown /> Current owner
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
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
