'use client'

import Spinner from '@/components/common/Spinner'
import { organisationContext } from '@/contexts/organisationContext'
import { GetOrganisationMemberDetail } from '@/graphql/queries/users/getOrganisationMemberDetail.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { useQuery } from '@apollo/client'
import Link from 'next/link'
import { useContext } from 'react'
import { FaBan, FaChevronLeft, FaClock, FaCog, FaKey, FaNetworkWired } from 'react-icons/fa'
import { Avatar } from '@/components/common/Avatar'
import { EmptyState } from '@/components/common/EmptyState'
import { OrganisationMemberType, UserTokenType, AppMembershipType } from '@/apollo/graphql'
import { DeleteMemberConfirmDialog } from '../_components/DeleteMemberConfirmDialog'
import { RoleSelector } from '../_components/RoleSelector'
import { relativeTimeFromDates } from '@/utils/time'
import { Button } from '@/components/common/Button'
import { SseLabel } from '@/components/apps/EncryptionModeIndicator'
import clsx from 'clsx'
import { DeleteUserTokenDialog } from '../_components/DeleteUserTokenDialog'
import CopyButton from '@/components/common/CopyButton'
import { AddAppToMemberButton } from '../_components/AddAppToMemberButton'
import { IPChip } from '../../network/_components/IPChip'
import { UpdateAccountNetworkPolicies } from '@/components/access/UpdateAccountNetworkPolicies'

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

  const userCanReadAppMemberships = organisation
    ? userHasPermission(organisation.role!.permissions, 'Apps', 'read')
    : false

  const userCanViewNetworkAccess = organisation
    ? userHasPermission(organisation?.role?.permissions, 'NetworkAccessPolicies', 'read')
    : false

  const userCanWriteAppMemberships = organisation
    ? userHasPermission(organisation.role!.permissions, 'Apps', 'update')
    : false

  const userCanReadMemberTokens = organisation
    ? userHasPermission(organisation.role!.permissions, 'MemberPersonalAccessTokens', 'read')
    : false

  const userCanDeleteMemberTokens = organisation
    ? userHasPermission(organisation.role!.permissions, 'MemberPersonalAccessTokens', 'delete')
    : false

  const { data, loading, error } = useQuery(GetOrganisationMemberDetail, {
    variables: {
      organisationId: organisation?.id,
      id: params.memberId,
    },
    skip: !organisation || !userCanReadMembers,
    fetchPolicy: 'cache-and-network',
  })

  const member: OrganisationMemberType | undefined = data?.organisationMembers[0]

  if (loading || !organisation) {
    return (
      <div className="flex justify-center items-center h-full w-full">
        <Spinner size="md" />
      </div>
    )
  }

  if (error) {
    return <div className="text-red-500 p-4">Error loading member data: {error.message}</div>
  }

  if (!userCanReadMembers && organisation) {
    return (
      <section className="p-4">
        <EmptyState
          title="Access restricted"
          subtitle="You don't have the permissions required to view this member."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl">
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
      <section className="p-4">
        <EmptyState
          title="Member not found"
          subtitle="This member doesn't exist or you don't have access to them."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl">
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
  const canDeleteMember = userCanDeleteMembers && !member.self && !isOwner

  // Determine if the current user can view this member's tokens section (self or has MemberTokens:read permission)
  const canViewTokensSection = member.self || userCanReadMemberTokens
  // Determine if the delete button should be shown for a specific token (self or has MemberTokens:delete permission)
  const canDeleteThisMembersTokens = member.self || userCanDeleteMemberTokens

  return (
    <section className="flex flex-col">
      <div className="pb-4 px-4 md:px-6 pt-4">
        <Link
          href={`/${params.team}/access/members`}
          className="text-neutral-500 flex items-center gap-2 text-sm hover:text-zinc-800 dark:hover:text-zinc-200 transition ease"
        >
          <FaChevronLeft /> Back to members
        </Link>
      </div>
      <div className="flex-grow overflow-y-auto px-4 md:px-6 space-y-8 pb-8">
        <div className="pt-4">
          <div className="flex items-center gap-4">
            <Avatar member={member} size="xl" />
            <div className="flex flex-col gap-1">
              <h3 className="text-2xl font-semibold">
                {member.fullName || 'User'} {member.self && ' (You)'}{' '}
              </h3>
              <span className="text-neutral-500 text-sm">{member.email}</span>
              {member.lastLogin ? (
                <span
                  className="text-neutral-500 text-xs flex items-center gap-1 cursor-help"
                  title={new Date(member.lastLogin).toLocaleString('en-GB', {
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    timeZoneName: 'short',
                  })}
                >
                  <FaClock /> Last login: {relativeTimeFromDates(new Date(member.lastLogin))}
                </span>
              ) : (
                <span className="text-neutral-500 text-xs flex items-center gap-1">
                  <FaClock /> Last login: Never
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="pt-4 space-y-4 border-t border-neutral-500/40">
          <div>
            <div className="text-xl font-semibold">Role</div>
            <div className="text-neutral-500">Manage the role for this member</div>
          </div>
          <div className="space-y-2">
            <div className="text-lg w-max">
              <RoleSelector
                member={member}
                organisationId={organisation.id}
                displayOnly={displayRoleOnly}
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-sm text-neutral-500">
                {member.role?.description || 'No description available for this role'}
              </div>
            </div>
          </div>
        </div>

        {userCanReadAppMemberships && (
          <div className="pt-4 space-y-4 border-t border-neutral-500/40">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xl font-semibold">App Access</div>
                <div className="text-neutral-500">
                  Apps and Environments this member has access to
                </div>
              </div>
              {userCanWriteAppMemberships && !member.self && (
                <AddAppToMemberButton
                  member={member}
                  organisationId={organisation.id}
                  teamSlug={params.team}
                />
              )}
            </div>

            <div className="space-y-2 divide-y divide-neutral-500/20 py-4">
              {member.appMemberships && member.appMemberships.length > 0 ? (
                member.appMemberships.map((app: AppMembershipType) => (
                  <div
                    key={app?.id}
                    className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center p-2 group"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="font-medium text-lg text-zinc-900 dark:text-zinc-100">
                          {app?.name}
                        </div>
                        <SseLabel sseEnabled={Boolean(app?.sseEnabled)} />
                      </div>
                      <div className="flex items-center gap-1 text-sm text-neutral-500 group/id">
                        <span className="text-neutral-500 text-2xs flex items-center">App ID:</span>
                        <CopyButton value={app.id} buttonVariant="ghost">
                          <span className="text-neutral-500 text-2xs font-mono hover:text-zinc-900 dark:hover:text-zinc-100 transition ease">
                            {app.id}
                          </span>
                        </CopyButton>
                      </div>
                    </div>

                    <div className="col-span-2">
                      <div className="text-2xs uppercase tracking-widest text-neutral-500 mb-1">
                        Environments
                      </div>
                      <div className="text-sm text-zinc-700 dark:text-zinc-300">
                        {app?.environments?.map((env) => env?.name).join(' + ') || '-'}
                      </div>
                    </div>

                    <div className="flex justify-end">
                      <Link
                        className="opacity-0 group-hover:opacity-100 transition ease"
                        href={`/${params.team}/apps/${app?.id}/access/members?manageAccount=${member.id}`}
                        title={`Manage ${member.fullName || member.email}'s access to ${app?.name}`}
                      >
                        <Button variant="secondary" className="flex items-center gap-2">
                          <FaCog className="h-4 w-4" />
                          <span>Manage</span>
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-neutral-500">
                  This member does not have explicit access to any Apps.
                </div>
              )}
            </div>
          </div>
        )}

        {userCanViewNetworkAccess && (
          <div className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xl font-semibold">Network Access Policy</div>
                <div className="text-neutral-500">
                  Manage the network access policy for this Account
                </div>
              </div>
              {member.networkPolicies?.length! > 0 && (
                <UpdateAccountNetworkPolicies account={member} />
              )}
            </div>

            {member.networkPolicies?.length! > 0 ? (
              <div className="divide-y divide-neutral-500/20 py-6">
                {member.networkPolicies?.map((policy) => (
                  <div key={policy.id} className="flex items-center justify-between gap-8 py-4">
                    <div className="flex items-center gap-2">
                      <FaNetworkWired className="text-neutral-500 shrink-0" />
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">
                        {policy.name}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {policy.allowedIps.split(',').map((ip) => (
                        <IPChip key={ip} ip={ip}></IPChip>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No Policy"
                subtitle={
                  <>
                    This member does not have any Network Access Policies associated with them.
                    <br /> Access is allowed from any IP address -{' '}
                    <span className="font-semibold font-mono">0.0.0.0/0, ::/0</span>
                  </>
                }
                graphic={
                  <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                    <FaNetworkWired />
                  </div>
                }
              >
                <UpdateAccountNetworkPolicies account={member} />
              </EmptyState>
            )}
          </div>
        )}

        {canViewTokensSection && (
          <div className="pt-4 space-y-4 border-t border-neutral-500/40">
            <div>
              <div className="text-xl font-semibold">Personal Access Tokens</div>
              <div className="text-neutral-500">Manage personal access tokens for this member</div>
            </div>

            <div className="space-y-2 divide-y divide-neutral-500/20 py-4">
              {member.tokens && member.tokens.length > 0 ? (
                member.tokens.map((token: UserTokenType) => {
                  const isExpired =
                    token!.expiresAt === null ? false : new Date(token!.expiresAt) < new Date()
                  return (
                    <div
                      key={token!.id}
                      className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center p-2 group"
                    >
                      <div className="md:col-span-4 space-y-1">
                        <div className="flex items-center gap-2">
                          <FaKey className="text-neutral-500 flex-shrink-0" />
                          <span className="font-medium text-lg text-zinc-900 dark:text-zinc-100 truncate">
                            {token!.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-sm text-neutral-500">
                          <span className="text-neutral-500 text-xs flex items-center">
                            Token ID:
                          </span>
                          <CopyButton
                            value={token!.id}
                            buttonVariant="ghost"
                            title="Copy Token ID to clipboard"
                          >
                            <span className="text-neutral-500 text-2xs font-mono hover:text-zinc-900 dark:hover:text-zinc-100 transition ease">
                              {token!.id}
                            </span>
                          </CopyButton>
                        </div>
                      </div>

                      <div className="md:col-span-4 text-neutral-500 text-sm flex  justify-center">
                        <div
                          className="whitespace-nowrap"
                          title={new Date(token?.createdAt).toLocaleString()}
                        >
                          Created {relativeTimeFromDates(new Date(token?.createdAt))}
                        </div>
                      </div>

                      <div className="md:col-span-3 space-y-2">
                        <div
                          className={clsx(
                            'flex items-center gap-1 text-sm ',
                            isExpired ? 'text-red-500' : 'text-neutral-500'
                          )}
                          title={
                            token.expiresAt
                              ? new Date(token.expiresAt).toLocaleString()
                              : 'Never expires'
                          }
                        >
                          <span className="whitespace-nowrap">
                            {isExpired ? 'Expired' : 'Expires'}
                          </span>
                          <span className="whitespace-nowrap">
                            {token!.expiresAt
                              ? relativeTimeFromDates(new Date(token?.expiresAt))
                              : 'never'}
                          </span>
                        </div>
                      </div>

                      {canDeleteThisMembersTokens && (
                        <div className="md:col-span-1 flex justify-end opacity-0 group-hover:opacity-100 transition ease">
                          <DeleteUserTokenDialog token={token!} organisationId={organisation.id} />
                        </div>
                      )}
                    </div>
                  )
                })
              ) : (
                <div className="py-8">
                  <EmptyState
                    title="No tokens created"
                    subtitle="This member has not created any personal access tokens."
                    graphic={
                      <div className="text-neutral-300 dark:text-neutral-700 text-7xl">
                        <FaKey />
                      </div>
                    }
                  >
                    <></>
                  </EmptyState>
                </div>
              )}
            </div>
          </div>
        )}

        {canDeleteMember && (
          <div className="pt-4 space-y-2 border-t border-neutral-500/40">
            <div>
              <div className="text-xl font-semibold">Danger Zone</div>
              <div className="text-neutral-500">
                This action is destructive and cannot be reversed
              </div>
            </div>

            <div className="flex justify-between items-center ring-1 ring-inset ring-red-500/40 bg-red-400/10 rounded-lg p-4">
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
