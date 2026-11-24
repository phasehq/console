'use client'

import { FormEvent, useId, useRef, useState } from 'react'
import { useMutation } from '@apollo/client'
import {
  FaCheck,
  FaChevronDown,
  FaChevronRight,
  FaClock,
  FaHourglassHalf,
  FaTrashAlt,
} from 'react-icons/fa'
import { toast } from 'react-toastify'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { AccessEndsField } from '@/components/agents/AgentAccessControls'
import { ConfirmAgentAction, GrantWorkflowDialog } from '@/components/agents/AgentDialogs'
import {
  GrantAgentWorkflowOp,
  RemoveAgentWorkflowGrantAllowOp,
} from '@/graphql/mutations/agents/manageAgents.gql'
import {
  UNTIL_REVOKED,
  accessEndsValue,
  describeExpiry,
  toLocalInputValue,
  type AccessEnds,
} from '@/utils/agents/accessDuration'
import {
  describeTarget,
  readTemporaryAllows,
  type TemporaryAllow,
} from '@/utils/agents/accessPolicy'
import {
  WRITE_CLASSES,
  describeClasses,
  formatAccessTime,
  isAppConnection,
} from '@/utils/agents/appAccess'

/**
 * What a grant's temporary allows on an app Connection give, in one phrase:
 * "Write access until 1 Dec 2026, 14:00" when they end together, '' otherwise.
 */
export const appAllowsLabel = (allows: TemporaryAllow[]): string => {
  const ends = new Set(allows.map((allow) => allow.expiresAt))
  if (allows.length === 0 || ends.size !== 1) return ''
  const classes = allows.flatMap((allow) => (allow.class ? [allow.class] : []))
  const write =
    classes.length === WRITE_CLASSES.length && WRITE_CLASSES.every((name) => classes.includes(name))
  return `${write ? 'Write' : describeClasses(classes)} access until ${formatAccessTime(
    allows[0].expiresAt
  )}`
}

/** "Ends in 3 hours", with the exact time on hover; nothing for access that does not end. */
export function GrantExpiryText({ expiresAt }: { expiresAt?: string | null }) {
  if (!expiresAt) return null
  const date = new Date(expiresAt)
  if (Number.isNaN(date.valueOf())) return null
  return (
    <time
      dateTime={date.toISOString()}
      title={date.toLocaleString()}
      className="text-2xs font-medium text-neutral-500"
    >
      {describeExpiry(expiresAt)}
    </time>
  )
}

/** Change when a grant ends, or remove the expiry by choosing until revoked. */
export function EditGrantExpiryDialog({
  workflowId,
  grant,
}: {
  workflowId: string
  grant: { connection: { id: string; name: string }; expiresAt?: string | null }
}) {
  const id = useId()
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const startingPoint = (): AccessEnds =>
    grant.expiresAt && !Number.isNaN(Date.parse(grant.expiresAt))
      ? { choice: 'custom', custom: toLocalInputValue(new Date(grant.expiresAt)) }
      : UNTIL_REVOKED
  const [ends, setEnds] = useState<AccessEnds>(startingPoint)
  const [failure, setFailure] = useState('')
  const [save, { loading }] = useMutation(GrantAgentWorkflowOp)
  const { expiresAt, problem } = accessEndsValue(ends)
  const unchanged =
    (expiresAt === null && !grant.expiresAt) ||
    (!!expiresAt && ends.choice === 'custom' && ends.custom === (startingPoint().custom ?? ''))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFailure('')
    const fresh = accessEndsValue(ends)
    if (fresh.problem) return
    try {
      await save({
        // An explicit null removes the expiry; leaving the argument out would keep it.
        variables: {
          workflowId,
          connectionId: grant.connection.id,
          expiresAt: fresh.expiresAt,
        },
        refetchQueries: ['GetAgentDetail'],
        awaitRefetchQueries: true,
      })
      toast.success(fresh.expiresAt ? 'Access end updated' : 'Access now lasts until revoked')
      dialogRef.current?.closeModal()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not change when access ends')
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title={`When access to ${grant.connection.name} ends`}
      size="sm"
      buttonVariant="ghost"
      buttonContent="Expiry"
      buttonProps={{ icon: FaClock, title: 'Change when access ends' }}
      onOpen={() => {
        setEnds(startingPoint())
        setFailure('')
      }}
    >
      <form onSubmit={submit} className="space-y-4 pt-4">
        <AccessEndsField id={`${id}-ends`} value={ends} onChange={setEnds} />
        {failure && (
          <div role="alert">
            <Alert variant="danger" icon size="sm">
              <span className="text-xs">{failure}</span>
            </Alert>
          </div>
        )}
        <div className="flex justify-end">
          <Button
            type="submit"
            icon={FaCheck}
            isLoading={loading}
            disabled={!!problem || unchanged}
            title={problem || (unchanged ? 'Nothing has changed.' : undefined)}
          >
            Save
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}

/**
 * Temporary allows in force on a grant. They come from approved requests, so
 * they cannot be edited; with `onRemove` each can be ended early.
 */
function TemporaryAllowList({
  allows,
  onRemove,
  app = false,
}: {
  allows: TemporaryAllow[]
  onRemove?: (allow: TemporaryAllow) => Promise<void>
  /** On an app Connection each allow is one kind of secrets call. */
  app?: boolean
}) {
  if (allows.length === 0) return null
  const describe = (allow: TemporaryAllow) =>
    app && allow.class ? `${describeClasses([allow.class])} secrets` : describeTarget(allow)
  return (
    <section aria-label="Temporary allows" className="space-y-1.5">
      <p className="text-xs text-neutral-500">
        Approved from Change Requests for this Workflow only. They let a call through that an Ask
        rule would refuse, until they end. They never override a Block.
      </p>
      <ul className="divide-y divide-neutral-500/10 rounded-lg border border-neutral-500/20">
        {allows.map((allow) => (
          <li
            key={allow.id}
            className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs"
          >
            {app ? (
              <span className="min-w-0 break-all font-medium">{describe(allow)}</span>
            ) : (
              <code className="min-w-0 break-all">{describe(allow)}</code>
            )}
            <time
              dateTime={allow.expiresAt}
              title={new Date(allow.expiresAt).toLocaleString()}
              className="shrink-0 text-neutral-500"
            >
              {describeExpiry(allow.expiresAt).replace('Ends', 'ends')}
            </time>
            {onRemove && (
              <ConfirmAgentAction
                title="Remove temporary allow"
                description={`${describe(allow)} will be refused again by the access rules straight away. The Agent can file another Change Request for it.`}
                actionLabel="Remove"
                triggerVariant="danger"
                triggerProps={{
                  icon: FaTrashAlt,
                  'aria-label': `Remove temporary allow for ${describe(allow)}`,
                  title: 'Remove temporary allow',
                }}
                onConfirm={() => onRemove(allow)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * "Temporary allows" on a grant row, with a count: the allows approved for
 * this Workflow that are still in force. A grant with none shows nothing.
 */
export function GrantTemporaryAllows({
  grant,
  canRemove,
}: {
  grant: {
    id: string
    connection: { name: string; serviceType?: string }
    temporaryAllows?: unknown
  }
  /** Ending an allow early needs permission to update the Workflow. */
  canRemove: boolean
}) {
  const [removeAllow] = useMutation(RemoveAgentWorkflowGrantAllowOp)
  const allows = readTemporaryAllows(grant.temporaryAllows)
  if (allows.length === 0) return null
  const app = isAppConnection(grant.connection.serviceType)
  const appLabel = app ? appAllowsLabel(allows) : ''
  const endAllow = async (allow: TemporaryAllow) => {
    await removeAllow({
      variables: { grantId: grant.id, allowId: allow.id },
      refetchQueries: ['GetAgentDetail'],
      awaitRefetchQueries: true,
    })
    toast.success('Temporary allow removed')
  }
  return (
    <GenericDialog
      title={`Temporary allows for ${grant.connection.name}`}
      size="md"
      buttonVariant="ghost"
      buttonContent={appLabel || `Temporary allows (${allows.length})`}
      buttonProps={{ icon: FaHourglassHalf, title: 'Temporary allows approved for this Workflow' }}
    >
      <div className="pt-4">
        <TemporaryAllowList allows={allows} onRemove={canRemove ? endAllow : undefined} app={app} />
      </div>
    </GenericDialog>
  )
}

export type ExpiredConnection = {
  connectionId: string
  connectionName: string
  serviceType: string
  expiredAt: string
}

/** Reads the expired Connections off a Workflow, ignoring anything not shaped like one. */
export const readExpiredConnections = (value: unknown): ExpiredConnection[] =>
  Array.isArray(value)
    ? value.flatMap((item): ExpiredConnection[] =>
        item &&
        typeof item === 'object' &&
        typeof item.connectionId === 'string' &&
        typeof item.connectionName === 'string' &&
        typeof item.expiredAt === 'string'
          ? [
              {
                connectionId: item.connectionId,
                connectionName: item.connectionName,
                serviceType: typeof item.serviceType === 'string' ? item.serviceType : '',
                expiredAt: item.expiredAt,
              },
            ]
          : []
      )
    : []

/** A quiet, collapsed note of grants that ended on their own, each with a way to grant it again. */
export function ExpiredConnections({
  workflowId,
  expired,
  grantable,
  canGrant,
}: {
  workflowId: string
  expired: ExpiredConnection[]
  /** Connections that can be granted now: active and not already granted. */
  grantable: Array<{ id: string; name: string; serviceType: string }>
  canGrant: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  if (expired.length === 0) return null
  return (
    <div className="border-t border-neutral-500/10 px-4 py-1.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-expired`}
        onClick={() => setOpen((current) => !current)}
        className="flex max-w-full items-center gap-1.5 text-left text-2xs text-neutral-500 hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:text-neutral-300"
      >
        {open ? <FaChevronDown aria-hidden="true" /> : <FaChevronRight aria-hidden="true" />}
        <span className="truncate">
          Access ended: {expired.map((item) => item.connectionName).join(', ')}
        </span>
      </button>
      {open && (
        <ul id={`${id}-expired`} className="mt-1 divide-y divide-neutral-500/10">
          {expired.map((item) => {
            const connection = grantable.find((candidate) => candidate.id === item.connectionId)
            return (
              <li
                key={item.connectionId}
                className="flex items-center justify-between gap-3 py-1 text-xs"
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">{item.connectionName}</span>{' '}
                  <span className="text-neutral-500">{describeExpiry(item.expiredAt)}</span>
                </span>
                {canGrant && connection && (
                  <GrantWorkflowDialog
                    workflowId={workflowId}
                    connections={[connection]}
                    initialConnectionId={connection.id}
                    triggerLabel="Grant again"
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
