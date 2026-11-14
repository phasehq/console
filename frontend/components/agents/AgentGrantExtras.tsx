'use client'

import { FormEvent, useId, useRef, useState } from 'react'
import { useMutation } from '@apollo/client'
import { FaCheck, FaChevronDown, FaChevronRight, FaClock } from 'react-icons/fa'
import { toast } from 'react-toastify'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { AccessEndsField } from '@/components/agents/AgentAccessControls'
import { GrantWorkflowDialog } from '@/components/agents/AgentDialogs'
import { GrantAgentWorkflowOp } from '@/graphql/mutations/agents/manageAgents.gql'
import {
  UNTIL_REVOKED,
  accessEndsValue,
  describeExpiry,
  toLocalInputValue,
  type AccessEnds,
} from '@/utils/agents/accessDuration'

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
  grantable: Array<{ id: string; name: string; serviceType: string; takesPolicy: boolean }>
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
