'use client'

import { ApiRotatingSecretHealthChoices, RotatingSecretType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { organisationContext } from '@/contexts/organisationContext'
import { GetRotatingSecrets } from '@/graphql/queries/secrets/rotation/getRotatingSecrets.gql'
import { humanReadableDurationLong } from '@/utils/time'
import { useQuery } from '@apollo/client'
import clsx from 'clsx'
import { ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { FaArrowsRotate, FaGear } from 'react-icons/fa6'

import { ProviderIcon } from '@/components/syncing/ProviderIcon'

import { ManageRotatingSecretDialog } from './ManageRotatingSecretDialog'
import { RotationStatusBadge } from './RotationStatusBadge'

interface RotatingSecretGroupProps {
  rotatingSecretId: string
  /** Fallback name shown while the rotating-secret query is in flight. */
  fallbackName?: string
  children: ReactNode
}

export const RotatingSecretGroup = ({
  rotatingSecretId,
  fallbackName,
  children,
}: RotatingSecretGroupProps) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const manageRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

  // Poll so the header keeps up with engine-driven state changes (health
  // flips, reschedules after a failed mint, etc.) — the Manage-dialog
  // refetch fires with a different variable set and doesn't update us.
  const { data } = useQuery(GetRotatingSecrets, {
    variables: { secretId: rotatingSecretId, orgId: organisation?.id },
    skip: !organisation,
    fetchPolicy: 'cache-and-network',
    pollInterval: 30_000,
  })

  const rotatingSecret: RotatingSecretType | null = data?.rotatingSecrets?.[0] ?? null

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!rotatingSecret?.isActive) return
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [rotatingSecret?.isActive])

  const statusLabel: string | null = (() => {
    if (!rotatingSecret) return null
    if (!rotatingSecret.isActive) return 'Rotation paused'
    if (!rotatingSecret.nextRotationAt) return null
    const remainingMs = new Date(rotatingSecret.nextRotationAt).getTime() - now
    if (remainingMs <= 0) return 'Rotating now'
    return `Rotates in ${humanReadableDurationLong(Math.floor(remainingMs / 1000))}`
  })()

  const statusTextColor = (() => {
    if (!rotatingSecret) return 'text-neutral-600 dark:text-neutral-400'
    if (!rotatingSecret.isActive) return 'text-neutral-500'
    switch (rotatingSecret.health) {
      case ApiRotatingSecretHealthChoices.Degraded:
        return 'text-amber-500'
      case ApiRotatingSecretHealthChoices.Failed:
        return 'text-red-500'
      default:
        return 'text-emerald-500'
    }
  })()

  return (
    <div
      className={clsx(
        'group/rotating-group ring-1 ring-inset ring-neutral-500/20 bg-zinc-100/50 dark:bg-zinc-800/60',
        'overflow-hidden'
      )}
    >
      <div
        className={clsx(
          'flex items-center justify-between gap-2 px-2 py-1.5',
          'bg-zinc-200/70 dark:bg-zinc-900/60 border-b border-neutral-500/10'
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={clsx(
              'inline-flex items-center gap-1 text-2xs font-medium whitespace-nowrap',
              'text-emerald-700 dark:text-emerald-300'
            )}
            title="Rotating secret"
          >
            <FaArrowsRotate className="text-[10px]" />
            <span className="truncate max-w-[16rem]">
              {rotatingSecret?.name ?? fallbackName ?? 'Rotating secret'}
            </span>
          </span>
          {rotatingSecret?.provider && (
            <span className="text-xs leading-none" title={rotatingSecret.provider}>
              <ProviderIcon providerId={rotatingSecret.provider} />
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 opacity-0 group-hover/rotating-group:opacity-100 focus-within:opacity-100 transition-opacity">
          {rotatingSecret && (
            <div
              className={clsx(
                'inline-flex items-center gap-1.5 text-2xs whitespace-nowrap',
                statusTextColor
              )}
            >
              <RotationStatusBadge
                health={rotatingSecret.health}
                isActive={rotatingSecret.isActive}
                size="sm"
                showLabel={false}
              />
              {statusLabel && <span>{statusLabel}</span>}
            </div>
          )}
          <Button
            variant="secondary"
            onClick={() => manageRef.current?.openModal()}
            title="Manage rotating secret"
            icon={FaGear}
          >
            Manage
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-0">{children}</div>

      {rotatingSecret && (
        <ManageRotatingSecretDialog ref={manageRef} rotatingSecret={rotatingSecret} />
      )}
    </div>
  )
}
