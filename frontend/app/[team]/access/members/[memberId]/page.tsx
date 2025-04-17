'use client'

import Spinner from '@/components/common/Spinner'
import { organisationContext } from '@/contexts/organisationContext'
import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { useQuery } from '@apollo/client'
import Link from 'next/link'
import { useContext } from 'react'
import { FaBan, FaChevronLeft, FaClock } from 'react-icons/fa'
import { Avatar } from '@/components/common/Avatar'
import { EmptyState } from '@/components/common/EmptyState'
import { OrganisationMemberType } from '@/apollo/graphql'
import { DeleteMemberConfirmDialog } from '../_components/DeleteMemberConfirmDialog'
import { RoleSelector } from '../_components/RoleSelector'
import { RoleLabel } from '@/components/users/RoleLabel'
import { relativeTimeFromDates } from '@/utils/time'

export default function MemberDetail({ params }: { params: { team: string; memberId: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanReadMembers = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Members', 'read')
    : false

  const userCanDeleteMembers = organisation
    ? userHasPermission(organisation?.role?.permissions, 'Members', 'delete', false)
    : false

  const userCanUpdateMemberRoles = organisation
    ? userHasPermission(organisation.role!.permissions, 'Members', 'update') &&
      userHasPermission(organisation.role!.permissions, 'Roles', 'read')
    : false

  const { data, loading, error } = useQuery(GetOrganisationMembers, {
    variables: {
      organisationId: organisation?.id,
      role: null, // Fetch all roles
    },
    skip: !organisation || !userCanReadMembers,
    fetchPolicy: 'cache-and-network',
  })

  // Find the specific member from the list
  const member: OrganisationMemberType | undefined = data?.organisationMembers.find(
    (m: OrganisationMemberType) => m.id === params.memberId
  )

  if (loading || !organisation) {
    return (
      <div className="flex justify-center items-center h-full">
        <Spinner size="md" />
      </div>
    )
  }

  if (error) {
    return <div className="text-red-500">Error loading member data: {error.message}</div>
  }

  if (!userCanReadMembers && organisation) {
    return (
      <section>
        <EmptyState
          title="Access restricted"
          subtitle="You don't have the permissions required to view members in this organisation."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaBan />
            </div>
          }
        >
          <Link
            href={`/${params.team}/access/members`}
            className="text-neutral-500 flex items-center gap-2 text-sm hover:text-zinc-800 dark:hover:text-zinc-200 transition ease"
          >
            <FaChevronLeft /> Back to members
          </Link>
        </EmptyState>
      </section>
    )
  }

  if (!member) {
    return (
      <section>
        <EmptyState
          title="Member not found"
          subtitle="This member doesn't exist or you don't have access to them."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaBan />
            </div>
          }
        >
          <Link
            href={`/${params.team}/access/members`}
            className="text-neutral-500 flex items-center gap-2 text-sm hover:text-zinc-800 dark:hover:text-zinc-200 transition ease"
          >
            <FaChevronLeft /> Back to members
          </Link>
        </EmptyState>
      </section>
    )
  }

  const isOwner = member.role?.name?.toLowerCase() === 'owner'
  const displayRoleOnly = !!(isOwner || !userCanUpdateMemberRoles || member.self)
  const canDelete = userCanDeleteMembers && !member.self && !isOwner

  return (
    <section className="overflow-y-auto h-full">
      <div className="pb-4">
        <Link
          href={`/${params.team}/access/members`}
          className="text-neutral-500 flex items-center gap-2 text-sm hover:text-zinc-800 dark:hover:text-zinc-200 transition ease"
        >
          <FaChevronLeft /> Back to members
        </Link>
      </div>
      <div className="w-full space-y-8 py-4 text-zinc-900 dark:text-zinc-100 divide-y divide-neutral-500/40">
        <div className="flex items-center gap-4">
          <Avatar member={member} size='xl' />
          <div className="flex flex-col gap-1">
            <h3 className="text-2xl font-semibold">
              {member.fullName || 'User'}
            </h3>
            <span className="text-neutral-500 text-sm">{member.email}</span>
            {member.lastLogin ? (
              <span 
                className="text-neutral-500 text-xs flex items-center gap-1 cursor-help"
                title={new Date(member.lastLogin).toLocaleString()}
              > 
                 <FaClock /> Last active: {relativeTimeFromDates(new Date(member.lastLogin))}
              </span>
            ) : (
              <span className="text-neutral-500 text-xs flex items-center gap-1">
                 <FaClock /> Last active: Never
              </span>
            )}
          </div>
        </div>

        <div className="py-4 space-y-4">
          <div>
            <div className="text-xl font-semibold">Role</div>
            <div className="text-neutral-500">Manage the role for this member</div>
          </div>
          <div className="space-y-2">
            <div className="text-lg w-max">
              <RoleSelector member={member} organisationId={organisation.id} displayOnly={displayRoleOnly} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-sm text-neutral-500">
                {member.role?.description || 'No description available for this role'}
              </div>
            </div>
          </div>
        </div>

        {canDelete && (
          <div className="space-y-2 py-4">
            <div>
              <div className="text-xl font-semibold">Danger Zone</div>
              <div className="text-neutral-500">
                This action is destructive and cannot be reversed
              </div>
            </div>

            <div className="flex justify-between items-center ring-1 ring-inset ring-red-500/40 bg-red-400/10 rounded-lg space-y-2 p-4">
              <div>
                <div className="font-medium text-red-400">Remove member</div>
                <div className="text-neutral-500">
                  Permanently remove this member from the organisation.
                </div>
              </div>
              <DeleteMemberConfirmDialog member={member} organisationId={organisation.id} />
            </div>
          </div>
        )}
      </div>
    </section>
  )
} 