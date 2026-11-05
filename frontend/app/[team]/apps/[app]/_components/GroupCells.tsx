'use client'

import {
  ApiRotatingSecretHealthChoices,
  DynamicSecretType,
  EnvironmentType,
  RotatingSecretType,
} from '@/apollo/graphql'
import { CreateLeaseDialog } from '@/ee/components/secrets/dynamic/CreateLeaseDialog'
import { DeleteDynamicSecretDialog } from '@/ee/components/secrets/dynamic/DeleteDynamicSecretDialog'
import { ManageLeasesDialog } from '@/ee/components/secrets/dynamic/ManageLeasesDialog'
import { UpdateDynamicSecretDialog } from '@/ee/components/secrets/dynamic/UpdateDynamicSecretDialog'
import { RotationStatusBadge } from '@/ee/components/secrets/rotation/RotationStatusBadge'
import { humanReadableDurationLong } from '@/utils/time'
import clsx from 'clsx'
import { memo, useEffect, useState } from 'react'

/**
 * A dynamic secret's actions in one env: generate, leases, manage and delete. They show
 * on hover or focus, like the single-env row they replace.
 */
export const DynamicSecretActions = memo(function DynamicSecretActions({
  secret,
  environment,
  onChanged,
}: {
  secret: DynamicSecretType
  environment: EnvironmentType
  /** Refreshes the grid after an edit or delete */
  onChanged: () => void
}) {
  return (
    <div className="group/dynamic relative flex h-full min-h-8 items-center px-2 py-1">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center truncate text-2xs text-neutral-500 transition-opacity group-focus-within/dynamic:opacity-0 group-hover/dynamic:opacity-0">
        Generated on lease
      </span>
      <div className="flex flex-wrap items-center gap-1 opacity-0 transition-opacity group-focus-within/dynamic:opacity-100 group-hover/dynamic:opacity-100">
        <CreateLeaseDialog secret={secret} />
        <ManageLeasesDialog secret={secret} />
        <UpdateDynamicSecretDialog secret={secret} environment={environment} onUpdated={onChanged} />
        <DeleteDynamicSecretDialog secret={secret} onDeleted={onChanged} />
      </div>
    </div>
  )
})

const rotationStatus = (rs: RotatingSecretType, now: number) => {
  if (rs.health === ApiRotatingSecretHealthChoices.Failed)
    return { label: 'Rotation failed', tone: 'text-red-500' }
  if (!rs.isActive) return { label: 'Rotation paused', tone: 'text-neutral-500' }
  if (!rs.nextRotationAt) return null
  const remainingMs = new Date(rs.nextRotationAt).getTime() - now
  const remaining = humanReadableDurationLong(Math.floor(remainingMs / 1000))
  // While degraded, the next run is a backoff retry rather than a scheduled rotation
  if (rs.health === ApiRotatingSecretHealthChoices.Degraded)
    return {
      label: remainingMs <= 0 ? 'Retrying now' : `Last mint failed · Retrying in ${remaining}`,
      tone: 'text-amber-500',
    }
  return {
    label: remainingMs <= 0 ? 'Rotating now' : `Rotates in ${remaining}`,
    tone: 'text-emerald-600 dark:text-emerald-400',
  }
}

/** A rotating secret's health and next rotation in one env; opens its manage dialog */
export const RotationStatusCell = memo(function RotationStatusCell({
  rotatingSecret,
  onManage,
}: {
  rotatingSecret: RotatingSecretType
  onManage: (rotatingSecretId: string) => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!rotatingSecret.isActive) return
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [rotatingSecret.isActive])

  const status = rotationStatus(rotatingSecret, now)
  const envName = rotatingSecret.environment?.name ?? 'this environment'

  return (
    <button
      type="button"
      onClick={() => onManage(rotatingSecret.id)}
      title={`Manage ${rotatingSecret.name} in ${envName}${status ? ` (${status.label})` : ''}`}
      className="flex h-full min-h-8 w-full min-w-0 items-center gap-2 px-3 py-1.5 transition-colors hover:bg-zinc-300/50 dark:hover:bg-zinc-800"
    >
      <RotationStatusBadge
        health={rotatingSecret.health}
        isActive={rotatingSecret.isActive}
        showLabel={!status}
      />
      {status && <span className={clsx('truncate text-2xs', status.tone)}>{status.label}</span>}
    </button>
  )
})
