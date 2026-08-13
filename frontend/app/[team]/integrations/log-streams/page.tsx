'use client'

import { useContext } from 'react'
import { useQuery } from '@apollo/client'
import { FaBan, FaStream } from 'react-icons/fa'
import { ApiOrganisationPlanChoices, LogStreamType } from '@/apollo/graphql'
import { GetLogStreams } from '@/graphql/queries/logstreams/getLogStreams.gql'
import { Alert } from '@/components/common/Alert'
import { EmptyState } from '@/components/common/EmptyState'
import Spinner from '@/components/common/Spinner'
import { PlanLabel } from '@/components/settings/organisation/PlanLabel'
import { UpsellDialog } from '@/components/settings/organisation/UpsellDialog'
import { organisationContext } from '@/contexts/organisationContext'
import { userHasGlobalAccess, userHasPermission } from '@/utils/access/permissions'
import { CreateLogStreamDialog } from '@/ee/components/logstreams/CreateLogStreamDialog'
import { LogStreamCard } from '@/ee/components/logstreams/LogStreamCard'

export default function LogStreams({ params }: { params: { team: string } }) {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  // permissions — log streams export org-wide activity, so every operation
  // additionally requires a role with global access (enforced server-side).
  const hasGlobalAccess = organisation
    ? userHasGlobalAccess(organisation.role?.permissions)
    : false
  const userCanReadLogStreams = organisation
    ? userHasPermission(organisation.role?.permissions, 'LogStreams', 'read') &&
      hasGlobalAccess
    : false
  const userCanCreateLogStreams = organisation
    ? userHasPermission(organisation.role?.permissions, 'LogStreams', 'create')
    : false
  const userCanUpdateLogStreams = organisation
    ? userHasPermission(organisation.role?.permissions, 'LogStreams', 'update')
    : false
  const userCanDeleteLogStreams = organisation
    ? userHasPermission(organisation.role?.permissions, 'LogStreams', 'delete')
    : false

  const { data, loading } = useQuery(GetLogStreams, {
    variables: { organisationId: organisation?.id },
    pollInterval: 10000,
    // The stream list fans out to per-stream lag/summary queries on the
    // backend — don't keep polling from hidden tabs.
    skipPollAttempt: () => document.hidden,
    skip: !organisation || !userCanReadLogStreams,
    fetchPolicy: 'cache-and-network',
    nextFetchPolicy: 'cache-and-network',
  })

  const streams: LogStreamType[] = data?.logStreams ?? []
  const isEnterprise = organisation?.plan === ApiOrganisationPlanChoices.En

  // Plan gate — Log Streams are Enterprise-only. A downgraded org with
  // existing streams still sees them so it can pause or delete (teardown is
  // deliberately not plan-gated server-side); create/resume/update stay
  // gated. The bare upsell only renders when there is nothing to manage.
  if (
    organisation &&
    !isEnterprise &&
    (!userCanReadLogStreams || (!loading && streams.length === 0))
  ) {
    return (
      <div className="w-full space-y-6 text-zinc-900 dark:text-zinc-100">
        <div>
          <h2 className="text-base font-medium">Log Streams</h2>
          <p className="text-neutral-500 text-sm">
            Stream audit logs and secret events to your SIEM or log management platform.
          </p>
        </div>
        <EmptyState
          title="Log Streams are available on the Enterprise tier"
          subtitle="Upgrade your organisation to stream audit logs and secret events to Datadog and other log management platforms."
          graphic={
            <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
              <FaStream />
            </div>
          }
        >
          <div className="pt-2">
            <UpsellDialog
              title="Upgrade to Enterprise to enable Log Streams"
              targetPlan={ApiOrganisationPlanChoices.En}
              buttonLabel={
                <span className="flex items-center gap-2">
                  Upgrade
                  <PlanLabel plan={ApiOrganisationPlanChoices.En} />
                </span>
              }
            />
          </div>
        </EmptyState>
      </div>
    )
  }

  // Permission gate
  if (organisation && !userCanReadLogStreams) {
    return (
      <EmptyState
        title="Access restricted"
        subtitle="You don't have the permissions required to view Log Streams in this organisation."
        graphic={
          <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
            <FaBan />
          </div>
        }
      >
        <></>
      </EmptyState>
    )
  }

  if (loading || !organisation)
    return (
      <div className="w-full flex items-center justify-center py-40">
        <Spinner size="md" />
      </div>
    )

  return (
    <div className="w-full space-y-6 text-black dark:text-white">
      <div className="border-b border-neutral-500/20 pb-4">
        <h2 className="text-base font-medium">Log Streams</h2>
        <p className="text-neutral-500 text-sm">
          Stream audit logs and secret events to your SIEM or log management platform in near
          real-time.
        </p>
      </div>

      {!isEnterprise && (
        <Alert variant="warning" icon>
          <div className="flex w-full flex-wrap items-center justify-between gap-4">
            <span>
              Your organisation is no longer on the Enterprise plan, so these streams have
              stopped shipping. You can pause or delete them — upgrade to resume streaming.
            </span>
            <UpsellDialog
              title="Upgrade to Enterprise to enable Log Streams"
              targetPlan={ApiOrganisationPlanChoices.En}
              buttonLabel={
                <span className="flex items-center gap-2">
                  Upgrade
                  <PlanLabel plan={ApiOrganisationPlanChoices.En} />
                </span>
              }
            />
          </div>
        </Alert>
      )}

      {streams.length > 0 && userCanCreateLogStreams && isEnterprise && (
        <div className="flex justify-end">
          <CreateLogStreamDialog />
        </div>
      )}

      {streams.length === 0 ? (
        <div className="flex flex-col text-center py-4 gap-6">
          <EmptyState
            title="No Log Streams"
            subtitle="Ship organisation audit events and secret events to Datadog. Events are delivered in near real-time with at-least-once delivery."
            graphic={
              <div className="text-neutral-300 dark:text-neutral-700 text-7xl text-center">
                <FaStream />
              </div>
            }
          >
            {userCanCreateLogStreams ? (
              <div className="pt-2 flex justify-center">
                <CreateLogStreamDialog />
              </div>
            ) : (
              <></>
            )}
          </EmptyState>
        </div>
      ) : (
        <div className="space-y-2">
          {streams.map((stream) => (
            <LogStreamCard
              key={stream.id}
              stream={stream}
              userCanUpdate={userCanUpdateLogStreams}
              userCanDelete={userCanDeleteLogStreams}
            />
          ))}
        </div>
      )}
    </div>
  )
}
