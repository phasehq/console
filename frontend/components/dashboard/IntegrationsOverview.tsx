'use client'

import Link from 'next/link'
import { useState } from 'react'
import { FaCheckCircle, FaClock, FaPlus, FaProjectDiagram, FaTimesCircle } from 'react-icons/fa'
import { Button } from '@/components/common/Button'
import { EmptyState } from '@/components/common/EmptyState'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import { ServiceSummary } from '@/utils/dashboard'
import { DashboardPanel, PanelLink, PanelSkeleton } from './DashboardPanel'

const LIST_SIZE = 8

const ServiceStatus = ({ service }: { service: ServiceSummary }) => {
  const { failing, pending } = service.syncs
  if (failing)
    return (
      <span className="inline-flex items-center gap-1 text-2xs font-medium text-red-500">
        <FaTimesCircle /> {failing} failing
      </span>
    )
  if (pending)
    return (
      <span className="inline-flex items-center gap-1 text-2xs text-neutral-500">
        <FaClock /> {pending} pending
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-2xs text-neutral-500">
      <FaCheckCircle className="text-emerald-500" /> Synced
    </span>
  )
}

export const IntegrationsOverview = (props: {
  team: string
  services: ServiceSummary[]
  loading: boolean
  canCreateSyncs: boolean
  className?: string
}) => {
  const { team, services, loading, canCreateSyncs, className } = props
  const [expanded, setExpanded] = useState(false)
  const max = Math.max(1, ...services.map((service) => service.syncs.total))
  // Failing services first so they stay in view when the list is collapsed.
  const ordered = [...services].sort(
    (a, b) => Number(b.syncs.failing > 0) - Number(a.syncs.failing > 0)
  )
  const shown = expanded ? ordered : ordered.slice(0, LIST_SIZE)

  return (
    <DashboardPanel
      className={className}
      title="Integrations"
      description="Where secrets are synced, by service"
      footer={<PanelLink href={`/${team}/integrations/syncs`}>All syncs</PanelLink>}
    >
      {loading && !services.length ? (
        <PanelSkeleton rows={4} />
      ) : services.length ? (
        <ul className="divide-y divide-neutral-500/10 border-t border-neutral-500/20">
          {shown.map((service) => (
            <li key={service.id} className="flex items-center gap-3 px-3 py-2 sm:px-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-zinc-200/70 text-base dark:bg-zinc-900/60">
                <ProviderIcon providerId={service.id} />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                    {service.name}
                  </span>
                  <ServiceStatus service={service} />
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1 flex-1 rounded-full bg-emerald-500/15">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${(service.syncs.total / max) * 100}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-2xs tabular-nums text-neutral-500">
                    {service.syncs.total} {service.syncs.total === 1 ? 'sync' : 'syncs'} ·{' '}
                    {service.appIds.length} {service.appIds.length === 1 ? 'app' : 'apps'}
                  </span>
                </div>
              </div>
            </li>
          ))}
          {services.length > LIST_SIZE && (
            <li className="px-3 py-2 text-center sm:px-4">
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="text-2xs font-medium text-neutral-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                {expanded ? 'Show fewer' : `Show all ${services.length} services`}
              </button>
            </li>
          )}
        </ul>
      ) : (
        <EmptyState
          size="sm"
          icon={<FaProjectDiagram />}
          title="No syncs"
          subtitle="Secrets aren't synced to any third-party services yet."
        >
          {canCreateSyncs && (
            <Link href={`/${team}/integrations/syncs`}>
              <Button variant="primary" icon={FaPlus}>
                Set up a sync
              </Button>
            </Link>
          )}
        </EmptyState>
      )}
    </DashboardPanel>
  )
}
