'use client'

import {
  ApiRotatingSecretCredentialStatusChoices,
  RotatingSecretCredentialType,
  RotatingSecretEventType,
  RotatingSecretType,
} from '@/apollo/graphql'
import Accordion from '@/components/common/Accordion'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { GetRotatingSecrets } from '@/graphql/queries/secrets/rotation/getRotatingSecrets.gql'
import { GetSecrets } from '@/graphql/queries/secrets/getSecrets.gql'
import { DeleteRotatingSecretOP } from '@/graphql/mutations/environments/secrets/rotation/deleteRotatingSecret.gql'
import { PauseRotatingSecretOP } from '@/graphql/mutations/environments/secrets/rotation/pauseRotatingSecret.gql'
import { ResumeRotatingSecretOP } from '@/graphql/mutations/environments/secrets/rotation/resumeRotatingSecret.gql'
import { RevokeRotatingSecretCredentialOP } from '@/graphql/mutations/environments/secrets/rotation/revokeRotatingSecretCredential.gql'
import { RotateRotatingSecretOP } from '@/graphql/mutations/environments/secrets/rotation/rotateRotatingSecret.gql'
import { organisationContext } from '@/contexts/organisationContext'
import { humanReadableDurationLong, relativeTimeFromDates } from '@/utils/time'
import { Tab } from '@headlessui/react'
import { useApolloClient, useMutation, useQuery } from '@apollo/client'
import clsx from 'clsx'
import {
  forwardRef,
  Fragment,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  FaArrowRotateRight,
  FaArrowsRotate,
  FaCircleExclamation,
  FaPause,
  FaPenToSquare,
  FaPlay,
  FaTrashCan,
} from 'react-icons/fa6'
import { toast } from 'react-toastify'

import { EditRotatingSecretDialog } from './EditRotatingSecretDialog'
import { RotationEventTimeline } from './RotationEventTimeline'
import { RotationStatusBadge } from './RotationStatusBadge'

type ManageRotatingSecretDialogRef = {
  openModal: () => void
  closeModal: () => void
}

const formatDuration = (seconds: number | null | undefined) =>
  seconds == null ? '—' : humanReadableDurationLong(seconds)

type StatusStyle = { color: string; bg: string; ring: string; label: string }

const CREDENTIAL_STATUS_STYLES: Partial<
  Record<ApiRotatingSecretCredentialStatusChoices | string, StatusStyle>
> = {
  [ApiRotatingSecretCredentialStatusChoices.Active]: {
    color: 'text-emerald-500',
    bg: 'bg-emerald-400/10',
    ring: 'ring-emerald-400/30',
    label: 'Active',
  },
  [ApiRotatingSecretCredentialStatusChoices.Expiring]: {
    color: 'text-blue-500',
    bg: 'bg-blue-400/10',
    ring: 'ring-blue-400/30',
    label: 'Expiring',
  },
  [ApiRotatingSecretCredentialStatusChoices.Revoking]: {
    color: 'text-amber-500',
    bg: 'bg-amber-400/10',
    ring: 'ring-amber-400/30',
    label: 'Revoking',
  },
  [ApiRotatingSecretCredentialStatusChoices.Revoked]: {
    color: 'text-zinc-500',
    bg: 'bg-zinc-400/10',
    ring: 'ring-zinc-400/30',
    label: 'Revoked',
  },
  [ApiRotatingSecretCredentialStatusChoices.MintFailed]: {
    color: 'text-red-500',
    bg: 'bg-red-400/10',
    ring: 'ring-red-400/30',
    label: 'Mint failed',
  },
  [ApiRotatingSecretCredentialStatusChoices.RevokeFailed]: {
    color: 'text-red-500',
    bg: 'bg-red-400/10',
    ring: 'ring-red-400/30',
    label: 'Revoke failed',
  },
  [ApiRotatingSecretCredentialStatusChoices.Pending]: {
    color: 'text-neutral-500',
    bg: 'bg-neutral-400/10',
    ring: 'ring-neutral-400/30',
    label: 'Pending',
  },
}

const FALLBACK_STATUS_STYLE: StatusStyle = {
  color: 'text-neutral-500',
  bg: 'bg-neutral-400/10',
  ring: 'ring-neutral-400/30',
  label: 'Unknown',
}

const URGENT_EXPIRING_STYLE: StatusStyle = {
  color: 'text-amber-500',
  bg: 'bg-amber-400/10',
  ring: 'ring-amber-400/30',
  label: 'Expiring soon',
}

const URGENT_WINDOW_MS = 24 * 60 * 60 * 1000

const CredentialCard = ({
  credential,
  onRevoke,
  revoking,
}: {
  credential: RotatingSecretCredentialType
  onRevoke: (id: string) => void
  revoking: boolean
}) => {
  const baseStyle = CREDENTIAL_STATUS_STYLES[credential.status] ?? FALLBACK_STATUS_STYLE
  const isUrgentExpiry =
    credential.status === ApiRotatingSecretCredentialStatusChoices.Expiring &&
    credential.expireAt !== null &&
    credential.expireAt !== undefined &&
    new Date(credential.expireAt).getTime() - Date.now() < URGENT_WINDOW_MS
  const style = isUrgentExpiry ? URGENT_EXPIRING_STYLE : baseStyle
  const isTerminal =
    credential.status === ApiRotatingSecretCredentialStatusChoices.Revoked ||
    credential.status === ApiRotatingSecretCredentialStatusChoices.RevokeFailed ||
    credential.revokedAt !== null
  // Active credentials are currently served; rotate (which mints a replacement) instead of revoking.
  const canRevoke =
    !isTerminal && credential.status !== ApiRotatingSecretCredentialStatusChoices.Active
  const badgeLabel =
    credential.status === ApiRotatingSecretCredentialStatusChoices.Expiring &&
    credential.expireAt
      ? `Expiring ${relativeTimeFromDates(new Date(credential.expireAt))}`
      : style.label
  return (
    <div className="py-3 grid grid-cols-2 gap-2">
      <div className="flex flex-col items-start gap-2">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              'text-2xs font-medium rounded-full px-2 py-0.5 ring-1 ring-inset whitespace-nowrap',
              style.color,
              style.bg,
              style.ring
            )}
          >
            {badgeLabel}
          </span>
          <span className="font-mono text-2xs text-neutral-500 truncate" title={credential.id}>
            {credential.providerCredentialId || credential.id}
          </span>
        </div>
        {credential.lastFailureReason &&
          credential.status !== ApiRotatingSecretCredentialStatusChoices.Revoked && (
            <div className="text-2xs text-red-500 flex items-start gap-1">
              <FaCircleExclamation className="mt-0.5" />
              <span>{credential.lastFailureReason}</span>
            </div>
          )}
      </div>
      <div className="text-2xs text-neutral-500 text-right flex flex-col gap-0.5 items-end">
        <span>
          Created {credential.createdAt && relativeTimeFromDates(new Date(credential.createdAt))}
        </span>
        {credential.revokedAt && (
          <span>Revoked {relativeTimeFromDates(new Date(credential.revokedAt))}</span>
        )}
        {canRevoke && (
          <div className="mt-2">
            <Button
              variant="danger"
              onClick={() => onRevoke(credential.id)}
              isLoading={revoking}
              icon={FaTrashCan}
            >
              Revoke now
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

const LifetimeBar = ({
  rotatingSecret,
}: {
  rotatingSecret: RotatingSecretType
}) => {
  const isPaused = !rotatingSecret.isActive
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    // Stop ticking while paused — the timer is frozen at pausedRemainingSeconds.
    if (isPaused) return
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [isPaused])

  const intervalSec = rotatingSecret.rotationIntervalSeconds ?? 0
  const revocationDelaySec = rotatingSecret.revocationDelaySeconds ?? 0

  const credentials = (rotatingSecret.credentials ?? []) as RotatingSecretCredentialType[]
  const activeCred = credentials.find(
    (c) => c.status === ApiRotatingSecretCredentialStatusChoices.Active
  )
  const expiringCred = credentials.find(
    (c) => c.status === ApiRotatingSecretCredentialStatusChoices.Expiring
  )

  if (!activeCred?.createdAt || intervalSec <= 0) {
    return null
  }

  const intervalMs = intervalSec * 1000
  // Anchor on next_rotation_at (or paused_remaining when paused) — both are
  // kept correct by the engine across pause/resume. Anchoring on the active
  // credential's createdAt would double-count paused wall-clock time.
  const remainingMs = isPaused
    ? (rotatingSecret.pausedRemainingSeconds ?? 0) * 1000
    : rotatingSecret.nextRotationAt
      ? Math.max(0, new Date(rotatingSecret.nextRotationAt).getTime() - now)
      : 0
  const elapsedMs = Math.max(0, Math.min(intervalMs, intervalMs - remainingMs))
  const greenPct = Math.min(100, (elapsedMs / intervalMs) * 100)

  const showBlue = !!expiringCred?.expireAt && revocationDelaySec > 0
  const expireMs = expiringCred?.expireAt ? new Date(expiringCred.expireAt).getTime() : 0
  const msUntilRevoke = showBlue ? Math.max(0, expireMs - now) : 0
  const isUrgentRevoke = showBlue && msUntilRevoke < 24 * 60 * 60 * 1000
  const bluePct = showBlue
    ? Math.min(100, (revocationDelaySec / intervalSec) * 100)
    : 0

  const formatMs = (ms: number) => {
    const total = Math.floor(ms / 1000)
    if (total < 60) return `${total}s`
    const m = Math.floor(total / 60)
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`
    const d = Math.floor(h / 24)
    return `${d}d${h % 24 ? ` ${h % 24}h` : ''}`
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-2xs text-neutral-500">
        <span>Current credential lifetime</span>
        <span>
          {formatMs(elapsedMs)} elapsed
          <span className="mx-1">·</span>
          {isPaused
            ? `paused, ${formatMs(remainingMs)} left`
            : `rotates in ${formatMs(remainingMs)}`}
        </span>
      </div>
      <div
        className="relative h-1 w-full rounded-sm bg-neutral-300 dark:bg-neutral-600 overflow-hidden"
        title={
          showBlue
            ? `Previous credential is revoked in ${formatMs(msUntilRevoke)}`
            : undefined
        }
      >
        {showBlue && (
          <div
            className={clsx(
              'absolute inset-y-0 left-0 z-0 rounded-sm transition-colors',
              isUrgentRevoke ? 'bg-amber-400' : 'bg-blue-400'
            )}
            style={{ width: `${bluePct}%` }}
          />
        )}
        <div
          className="absolute inset-y-0 left-0 z-10 rounded-sm bg-emerald-500 transition-all ease"
          style={{ width: `${greenPct}%` }}
        />
      </div>
      {showBlue && (
        <div className="text-2xs text-neutral-500 flex items-center gap-1">
          <span
            className={clsx(
              'inline-block h-2 w-2 rounded-sm',
              isUrgentRevoke ? 'bg-amber-400' : 'bg-blue-400'
            )}
          />
          Previous credential is revoked in {formatMs(msUntilRevoke)}
        </div>
      )}
    </div>
  )
}

interface ManageRotatingSecretDialogProps {
  rotatingSecret: RotatingSecretType
}

export const ManageRotatingSecretDialog = forwardRef<
  ManageRotatingSecretDialogRef,
  ManageRotatingSecretDialogProps
>(({ rotatingSecret: initialRotatingSecret }, ref) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const editRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

  useImperativeHandle(ref, () => ({
    openModal: () => dialogRef.current?.openModal(),
    closeModal: () => dialogRef.current?.closeModal(),
  }))

  const [tab, setTab] = useState(0)
  const [isOpen, setIsOpen] = useState(false)

  const { data: liveData } = useQuery(GetRotatingSecrets, {
    variables: { secretId: initialRotatingSecret.id, orgId: organisation?.id },
    fetchPolicy: 'cache-and-network',
    pollInterval: 5000,
    skip: !isOpen || !organisation,
  })
  const rotatingSecret: RotatingSecretType =
    (liveData?.rotatingSecrets?.[0] as RotatingSecretType | undefined) ?? initialRotatingSecret

  const refetchQueries = useMemo(
    () => [
      {
        query: GetRotatingSecrets,
        variables: {
          orgId: organisation?.id,
          envId: rotatingSecret.environment?.id,
        },
      },
      {
        query: GetSecrets,
        variables: {
          appId: rotatingSecret.environment?.app?.id,
          envId: rotatingSecret.environment?.id,
          path: rotatingSecret.path ?? '/',
        },
      },
    ],
    [organisation, rotatingSecret]
  )

  const [rotateNow, { loading: rotating }] = useMutation(RotateRotatingSecretOP, { refetchQueries })
  const [pause, { loading: pausing }] = useMutation(PauseRotatingSecretOP, { refetchQueries })
  const [resume, { loading: resuming }] = useMutation(ResumeRotatingSecretOP, { refetchQueries })
  const [deleteSecret, { loading: deleting }] = useMutation(DeleteRotatingSecretOP, {
    refetchQueries,
  })
  const [revokeCredential, { loading: revoking }] = useMutation(RevokeRotatingSecretCredentialOP, {
    refetchQueries,
  })

  const apollo = useApolloClient()
  const [refreshing, setRefreshing] = useState(false)
  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await apollo.refetchQueries({ include: [GetRotatingSecrets] })
    } finally {
      setRefreshing(false)
    }
  }

  const handleRotate = async () => {
    try {
      await rotateNow({ variables: { rotatingSecretId: rotatingSecret.id } })
      toast.success('Rotation triggered')
    } catch (e: any) {
      toast.error(e.message ?? 'Rotation failed')
    }
  }

  const handleTogglePause = async () => {
    try {
      if (rotatingSecret.isActive) {
        await pause({ variables: { rotatingSecretId: rotatingSecret.id } })
        toast.success('Rotation paused')
      } else {
        await resume({ variables: { rotatingSecretId: rotatingSecret.id } })
        toast.success('Rotation resumed')
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Operation failed')
    }
  }

  const [confirmDelete, setConfirmDelete] = useState(false)
  const handleDelete = async () => {
    try {
      await deleteSecret({ variables: { rotatingSecretId: rotatingSecret.id } })
      toast.success('Rotating secret deleted')
      dialogRef.current?.closeModal()
    } catch (e: any) {
      toast.error(e.message ?? 'Delete failed')
    }
  }

  const handleRevokeCredential = async (credentialId: string) => {
    try {
      await revokeCredential({ variables: { credentialId } })
      toast.success('Credential revoked')
    } catch (e: any) {
      toast.error(e.message ?? 'Revoke failed')
    }
  }

  return (
    <>
    <EditRotatingSecretDialog ref={editRef} rotatingSecret={rotatingSecret} />
    <GenericDialog
      ref={dialogRef}
      title={`Manage rotating secret`}
      dialogTitle={
        <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100">
          <span className="text-base font-semibold">{rotatingSecret.name}</span>
          <RotationStatusBadge
            health={rotatingSecret.health}
            isActive={rotatingSecret.isActive}
            size="sm"
          />
        </div>
      }
      size="lg"
      onOpen={() => setIsOpen(true)}
      onClose={() => {
        setIsOpen(false)
        setConfirmDelete(false)
      }}
    >
      <div className="pt-2">
        <Tab.Group selectedIndex={tab} onChange={setTab}>
          <Tab.List className="flex gap-2 w-full border-b border-neutral-500/20">
            {['Status', 'Credentials', 'Events'].map((label) => (
              <Tab as={Fragment} key={label}>
                {({ selected }) => (
                  <div
                    className={clsx(
                      'p-2 text-xs font-medium border-b focus:outline-none text-black dark:text-white cursor-pointer',
                      selected
                        ? 'border-emerald-500 font-semibold'
                        : 'border-transparent'
                    )}
                  >
                    {label}
                  </div>
                )}
              </Tab>
            ))}
          </Tab.List>

          <Tab.Panels className="pt-4">
            {/* Status */}
            <Tab.Panel className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-neutral-500">Provider</div>
                  <div className="font-medium text-zinc-900 dark:text-zinc-100 capitalize">
                    {rotatingSecret.provider}
                  </div>
                </div>
                <div>
                  <div className="text-neutral-500">Authentication</div>
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">
                    {rotatingSecret.authentication?.name ?? '—'}
                  </div>
                </div>
                <div>
                  <div className="text-neutral-500">Rotation interval</div>
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">
                    {formatDuration(rotatingSecret.rotationIntervalSeconds)}
                  </div>
                </div>
                <div>
                  <div className="text-neutral-500">Revocation delay</div>
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">
                    {rotatingSecret.revocationDelaySeconds
                      ? formatDuration(rotatingSecret.revocationDelaySeconds)
                      : 'None (instant)'}
                  </div>
                </div>
                <div>
                  <div className="text-neutral-500">Next rotation</div>
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">
                    {rotatingSecret.nextRotationAt
                      ? relativeTimeFromDates(new Date(rotatingSecret.nextRotationAt))
                      : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-neutral-500">Consecutive failures</div>
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">
                    {rotatingSecret.consecutiveFailureCount ?? 0}
                  </div>
                </div>
              </div>

              <LifetimeBar rotatingSecret={rotatingSecret} />

              {rotatingSecret.lastFailureReason && (
                <div className="text-xs text-red-500 border border-red-500/30 bg-red-400/10 rounded p-3">
                  <div className="font-semibold mb-1 flex items-center gap-1">
                    <FaCircleExclamation /> Last failure
                  </div>
                  <div className="break-all">{rotatingSecret.lastFailureReason}</div>
                  {rotatingSecret.lastFailureAt && (
                    <div className="text-2xs text-neutral-500 mt-1">
                      {relativeTimeFromDates(new Date(rotatingSecret.lastFailureAt))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-neutral-500/20">
                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    onClick={handleRotate}
                    isLoading={rotating}
                    disabled={!rotatingSecret.isActive}
                    title={!rotatingSecret.isActive ? 'Resume rotation first' : 'Rotate now'}
                    icon={FaArrowsRotate}
                  >
                    Rotate now
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleTogglePause}
                    isLoading={pausing || resuming}
                    icon={rotatingSecret.isActive ? FaPause : FaPlay}
                  >
                    {rotatingSecret.isActive ? 'Pause' : 'Resume'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => editRef.current?.openModal()}
                    icon={FaPenToSquare}
                  >
                    Edit
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  {confirmDelete ? (
                    <>
                      <span className="text-2xs text-red-500">Are you sure?</span>
                      <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
                        Cancel
                      </Button>
                      <Button
                        variant="danger"
                        onClick={handleDelete}
                        isLoading={deleting}
                        icon={FaTrashCan}
                      >
                        Confirm delete
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="danger"
                      onClick={() => setConfirmDelete(true)}
                      icon={FaTrashCan}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </Tab.Panel>

            {/* Credentials */}
            <Tab.Panel>
              <div className="flex justify-end py-1">
                <Button
                  variant="ghost"
                  onClick={handleRefresh}
                  isLoading={refreshing}
                  icon={FaArrowRotateRight}
                  title="Refresh credentials"
                >
                  Refresh
                </Button>
              </div>
              {!rotatingSecret.credentials?.length ? (
                <div className="text-sm text-neutral-500 py-4">No credentials yet.</div>
              ) : (
                (() => {
                  const allCreds = (rotatingSecret.credentials ??
                    []) as RotatingSecretCredentialType[]
                  const liveCreds = allCreds.filter(
                    (c) =>
                      c.status !== ApiRotatingSecretCredentialStatusChoices.Revoked
                  )
                  const revokedCreds = allCreds.filter(
                    (c) =>
                      c.status === ApiRotatingSecretCredentialStatusChoices.Revoked
                  )
                  return (
                    <div className="max-h-[75vh] overflow-y-auto">
                      <div className="divide-y divide-neutral-500/20">
                        {liveCreds.map((c) => (
                          <CredentialCard
                            key={c.id}
                            credential={c}
                            onRevoke={handleRevokeCredential}
                            revoking={revoking}
                          />
                        ))}
                      </div>
                      {revokedCreds.length > 0 && (
                        <Accordion
                          title={`${revokedCreds.length} revoked credential${
                            revokedCreds.length === 1 ? '' : 's'
                          }`}
                          className="mt-2 border-t border-neutral-500/20"
                        >
                          <div className="divide-y divide-neutral-500/20">
                            {revokedCreds.map((c) => (
                              <CredentialCard
                                key={c.id}
                                credential={c}
                                onRevoke={handleRevokeCredential}
                                revoking={revoking}
                              />
                            ))}
                          </div>
                        </Accordion>
                      )}
                    </div>
                  )
                })()
              )}
            </Tab.Panel>

            {/* Events */}
            <Tab.Panel>
              <div className="flex justify-end py-1">
                <Button
                  variant="ghost"
                  onClick={handleRefresh}
                  isLoading={refreshing}
                  icon={FaArrowRotateRight}
                  title="Refresh events"
                >
                  Refresh
                </Button>
              </div>
              <div className="max-h-[75vh] overflow-y-auto">
                <RotationEventTimeline
                  events={(rotatingSecret.events as RotatingSecretEventType[]) ?? []}
                />
              </div>
            </Tab.Panel>
          </Tab.Panels>
        </Tab.Group>
      </div>
    </GenericDialog>
    </>
  )
})

ManageRotatingSecretDialog.displayName = 'ManageRotatingSecretDialog'
