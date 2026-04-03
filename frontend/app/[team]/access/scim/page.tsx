'use client'

import { useContext } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { toast } from 'react-toastify'
import Link from 'next/link'
import { FaBan, FaChevronRight, FaKey } from 'react-icons/fa'
import CopyButton from '@/components/common/CopyButton'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { organisationContext } from '@/contexts/organisationContext'
import { GetSCIMTokens } from '@/graphql/queries/scim/getSCIMTokens.gql'
import { GetSCIMEvents } from '@/graphql/queries/scim/getSCIMEvents.gql'
import GetOrganisations from '@/graphql/queries/getOrganisations.gql'
import { ToggleSCIMOp } from '@/graphql/mutations/scim/toggleSCIM.gql'
import { ToggleSCIMTokenOp } from '@/graphql/mutations/scim/toggleSCIMToken.gql'
import { userHasPermission } from '@/utils/access/permissions'
import { CreateSCIMTokenDialog } from './_components/SCIMTokenDialogs'
import { SCIMTokensTable } from './_components/SCIMTokensTable'
import { SCIMEventsTable } from './_components/SCIMEventsTable'

export default function SCIMPage({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanManageSCIM = organisation
    ? userHasPermission(organisation.role!.permissions, 'SCIM', 'update')
    : false

  const userCanReadSCIM = organisation
    ? userHasPermission(organisation.role!.permissions, 'SCIM', 'read')
    : false

  const { data, loading } = useQuery(GetSCIMTokens, {
    variables: { organisationId: organisation?.id },
    skip: !organisation || !userCanReadSCIM,
  })

  const { data: eventsData, loading: eventsLoading } = useQuery(GetSCIMEvents, {
    variables: { organisationId: organisation?.id },
    skip: !organisation || !userCanReadSCIM,
    pollInterval: 10000,
  })

  const [toggleSCIM] = useMutation(ToggleSCIMOp, {
    refetchQueries: [{ query: GetOrganisations }],
  })

  const [toggleSCIMToken] = useMutation(ToggleSCIMTokenOp, {
    refetchQueries: [{ query: GetSCIMTokens, variables: { organisationId: organisation?.id } }],
  })

  const tokens = data?.scimTokens || []
  const previewTokens = tokens.slice(0, 3)
  const allEvents = eventsData?.scimEvents?.events || []
  const previewEvents = allEvents.slice(0, 10)
  const totalEvents = eventsData?.scimEvents?.count || 0
  const scimEnabled = organisation?.scimEnabled ?? false

  const handleToggleSCIM = async () => {
    try {
      await toggleSCIM({
        variables: {
          organisationId: organisation!.id,
          enabled: !scimEnabled,
        },
      })
      toast.success(scimEnabled ? 'SCIM disabled' : 'SCIM enabled')
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle SCIM')
    }
  }

  const handleToggleToken = async (tokenId: string, currentActive: boolean) => {
    try {
      await toggleSCIMToken({
        variables: { tokenId, isActive: !currentActive },
      })
      toast.success(currentActive ? 'Token disabled' : 'Token enabled')
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle token')
    }
  }

  if (!organisation)
    return (
      <div className="flex items-center justify-center p-10">
        <Spinner size="md" />
      </div>
    )

  if (!userCanReadSCIM)
    return (
      <section className="px-3 sm:px-4 lg:px-6">
        <EmptyState
          title="Access restricted"
          subtitle="You don't have the permissions required to manage SCIM provisioning."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaBan />
            </div>
          }
        >
          <></>
        </EmptyState>
      </section>
    )

  return (
    <section className="px-3 sm:px-4 lg:px-6">
      <div className="w-full space-y-6 text-zinc-900 dark:text-zinc-100">
        <div>
          <h2 className="text-base font-medium">SCIM Provisioning</h2>
          <p className="text-neutral-500 text-sm">
            Manage SCIM tokens for automatic user and group provisioning from your identity
            provider.
          </p>
        </div>

        {/* Master Toggle */}
        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800">
          <div>
            <div className="text-sm font-medium">Enable SCIM</div>
            <div className="text-neutral-500 text-xs">
              {scimEnabled
                ? 'SCIM is enabled. Identity providers can sync users and groups.'
                : 'Enable SCIM to allow identity providers to sync users and groups.'}
            </div>
          </div>
          {userCanManageSCIM && (
            <ToggleSwitch value={scimEnabled} onToggle={handleToggleSCIM} />
          )}
        </div>

        {scimEnabled && (
          <>
            {/* SCIM Base URL */}
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-neutral-500 mb-0.5">SCIM Base URL</div>
                <code className="text-sm font-mono text-zinc-900 dark:text-zinc-100">
                  {typeof window !== 'undefined'
                    ? `${window.location.origin}/service/scim/v2/`
                    : '/service/scim/v2/'}
                </code>
              </div>
              <CopyButton
                value={
                  typeof window !== 'undefined'
                    ? `${window.location.origin}/service/scim/v2/`
                    : '/service/scim/v2/'
                }
              />
            </div>

            {/* Provider Connections Preview */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Provider Connections</div>
                  <div className="text-neutral-500 text-xs">
                    Identity provider connections via SCIM tokens.
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {userCanManageSCIM && (
                    <CreateSCIMTokenDialog organisationId={organisation.id} />
                  )}
                </div>
              </div>

              {loading && !data ? (
                <div className="flex items-center justify-center p-10">
                  <Spinner size="md" />
                </div>
              ) : tokens.length === 0 ? (
                <EmptyState
                  title="No provider connections"
                  subtitle="Create a token to connect your identity provider."
                  graphic={
                    <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                      <FaKey />
                    </div>
                  }
                >
                  {userCanManageSCIM && (
                    <CreateSCIMTokenDialog organisationId={organisation.id} />
                  )}
                </EmptyState>
              ) : (
                <>
                  <SCIMTokensTable
                    tokens={previewTokens}
                    organisationId={organisation.id}
                    userCanManageSCIM={userCanManageSCIM}
                    onToggleToken={handleToggleToken}
                  />
                  {tokens.length > 3 && (
                    <Link
                      href={`/${params.team}/access/scim/connections`}
                      className="flex items-center justify-center gap-1.5 text-xs text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition py-2"
                    >
                      View all {tokens.length} connections
                      <FaChevronRight className="text-2xs" />
                    </Link>
                  )}
                </>
              )}
            </div>

            {/* Provisioning Logs Preview */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">Provisioning Logs</div>
                  <div className="text-neutral-500 text-xs">
                    Recent SCIM provisioning activity from your identity providers.
                  </div>
                </div>
                {allEvents.length > 0 && (
                  <Link
                    href={`/${params.team}/access/scim/logs`}
                    className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition"
                  >
                    View all
                    <FaChevronRight className="text-2xs" />
                  </Link>
                )}
              </div>

              {eventsLoading && allEvents.length === 0 ? (
                <div className="flex items-center justify-center p-10">
                  <Spinner size="md" />
                </div>
              ) : allEvents.length === 0 ? (
                <div className="text-center py-8 text-neutral-500 text-sm">
                  No provisioning events yet. Events will appear here when your identity provider
                  syncs users or groups.
                </div>
              ) : (
                <>
                  <SCIMEventsTable events={previewEvents} />
                  {totalEvents > 10 && (
                    <Link
                      href={`/${params.team}/access/scim/logs`}
                      className="flex items-center justify-center gap-1.5 text-xs text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition py-2"
                    >
                      View all {totalEvents} events
                      <FaChevronRight className="text-2xs" />
                    </Link>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
