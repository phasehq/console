'use client'

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { FaEdit, FaPlus, FaTrash, FaUsers } from 'react-icons/fa'
import { toast } from 'react-toastify'
import type { OrganisationMemberType } from '@/apollo/graphql'
import { Avatar } from '@/components/common/Avatar'
import { Button } from '@/components/common/Button'
import { Checkbox } from '@/components/common/Checkbox'
import GenericDialog from '@/components/common/GenericDialog'
import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import { GetAgentMemberships } from '@/graphql/queries/agents/getAgentMemberships.gql'
import {
  AssignAgentMemberOp,
  RemoveAgentMemberOp,
  UpdateAgentMemberWorkflowsOp,
} from '@/graphql/mutations/agents/manageAgents.gql'
import { ConfirmAgentAction } from '@/components/agents/AgentDialogs'
import { AgentBadge, AgentEmpty, AgentError, AgentLoading } from '@/components/agents/AgentUI'
import { userHasGlobalAccess } from '@/utils/access/permissions'

type NamedWorkflow = { id: string; name: string }

type Member = {
  id: string
  email?: string | null
  fullName?: string | null
  avatarUrl?: string | null
  role?: {
    id: string
    name?: string | null
    color?: string | null
    permissions?: string | null
  } | null
}

type Membership = {
  id: string
  member: Member
  workflows: NamedWorkflow[]
  assignedBy?: { id: string; email?: string | null; fullName?: string | null } | null
  createdAt?: string | null
}

type DialogHandle = { closeModal: () => void }

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'The Agent membership could not be updated'

const displayName = (member?: Member | null) =>
  member?.fullName || member?.email || 'Unknown member'

function MemberIdentity({ member }: { member: Member }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar member={member as OrganisationMemberType} size="md" showTitle={false} />
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{displayName(member)}</div>
        {member.fullName && member.email && (
          <div className="truncate text-2xs text-neutral-500">{member.email}</div>
        )}
      </div>
    </div>
  )
}

function WorkflowPicker({
  workflows,
  selected,
  onChange,
}: {
  workflows: NamedWorkflow[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const toggle = (workflowId: string) => {
    const next = new Set(selected)
    if (next.has(workflowId)) next.delete(workflowId)
    else next.add(workflowId)
    onChange(next)
  }

  return (
    <fieldset>
      <legend className="mb-2 text-xs text-neutral-500">Workflow access *</legend>
      <div className="max-h-56 divide-y divide-neutral-500/20 overflow-y-auto rounded-lg border border-neutral-500/20">
        {workflows.map((workflow) => (
          <div
            key={workflow.id}
            className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-neutral-500/5"
          >
            <span className="min-w-0 truncate text-xs font-medium">{workflow.name}</span>
            <Checkbox
              size="sm"
              checked={selected.has(workflow.id)}
              onChange={() => toggle(workflow.id)}
            />
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-2xs text-neutral-500">
        Select at least one workflow. Tokens and runtime access are restricted to these workflows.
      </p>
    </fieldset>
  )
}

function AddAgentMemberDialog({
  organisationId,
  agentId,
  workflows,
  memberships,
}: {
  organisationId: string
  agentId: string
  workflows: NamedWorkflow[]
  memberships: Membership[]
}) {
  const dialogRef = useRef<DialogHandle>(null)
  const [memberId, setMemberId] = useState('')
  const [workflowIds, setWorkflowIds] = useState<Set<string>>(
    () => new Set(workflows[0] ? [workflows[0].id] : [])
  )
  const { data, loading: loadingMembers } = useQuery(GetOrganisationMembers, {
    variables: { organisationId, role: null },
  })
  const [assignMember, { loading }] = useMutation(AssignAgentMemberOp)
  const existingIds = useMemo(
    () => new Set(memberships.map((membership) => membership.member.id)),
    [memberships]
  )
  const availableMembers: Member[] = (data?.organisationMembers || []).filter(
    (member: Member | null): member is Member =>
      !!member &&
      !existingIds.has(member.id) &&
      !userHasGlobalAccess(member.role?.permissions || '')
  )

  useEffect(() => {
    if (!availableMembers.some((member) => member.id === memberId)) {
      setMemberId(availableMembers[0]?.id || '')
    }
  }, [availableMembers, memberId])

  const reset = () => {
    setMemberId('')
    setWorkflowIds(new Set(workflows[0] ? [workflows[0].id] : []))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!memberId || workflowIds.size === 0) return
    try {
      await assignMember({
        variables: { agentId, memberId, workflowIds: Array.from(workflowIds) },
        refetchQueries: ['GetAgentMemberships', 'GetAgentDetail', 'GetAgents'],
        awaitRefetchQueries: true,
      })
      toast.success('Member assigned to Agent')
      dialogRef.current?.closeModal()
      reset()
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Assign member"
      size="sm"
      buttonContent={
        <>
          <FaPlus /> Assign member
        </>
      }
      buttonProps={{ disabled: loadingMembers || availableMembers.length === 0 }}
      onClose={reset}
    >
      <form onSubmit={submit} className="space-y-4 pt-4">
        <div>
          <label htmlFor="agent-member" className="mb-2 block text-xs text-neutral-500">
            Organisation member *
          </label>
          <select
            id="agent-member"
            value={memberId}
            onChange={(event) => setMemberId(event.target.value)}
            disabled={loadingMembers || availableMembers.length === 0}
            className="custom w-full rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-800 ring-1 ring-inset ring-neutral-500/40 focus:ring-emerald-500 dark:bg-zinc-800 dark:text-zinc-100"
          >
            {availableMembers.length === 0 && <option value="">No members available</option>}
            {availableMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {displayName(member)}
              </option>
            ))}
          </select>
        </div>
        <WorkflowPicker workflows={workflows} selected={workflowIds} onChange={setWorkflowIds} />
        <div className="flex justify-end">
          <Button type="submit" isLoading={loading} disabled={!memberId || workflowIds.size === 0}>
            Assign access
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}

function EditAgentMemberDialog({
  membership,
  workflows,
}: {
  membership: Membership
  workflows: NamedWorkflow[]
}) {
  const dialogRef = useRef<DialogHandle>(null)
  const currentIds = () => new Set(membership.workflows.map((workflow) => workflow.id))
  const [workflowIds, setWorkflowIds] = useState<Set<string>>(currentIds)
  const [updateWorkflows, { loading }] = useMutation(UpdateAgentMemberWorkflowsOp)

  useEffect(
    () => setWorkflowIds(new Set(membership.workflows.map((workflow) => workflow.id))),
    [membership.workflows]
  )

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (workflowIds.size === 0) return
    try {
      await updateWorkflows({
        variables: { membershipId: membership.id, workflowIds: Array.from(workflowIds) },
        refetchQueries: ['GetAgentMemberships', 'GetAgentDetail', 'GetAgents'],
        awaitRefetchQueries: true,
      })
      toast.success('Workflow access updated')
      dialogRef.current?.closeModal()
    } catch (error) {
      toast.error(errorText(error))
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title={`Edit ${displayName(membership.member)} access`}
      size="sm"
      buttonVariant="ghost"
      buttonContent={
        <>
          <FaEdit /> Edit
        </>
      }
      onClose={() => setWorkflowIds(currentIds())}
    >
      <form onSubmit={submit} className="space-y-4 pt-4">
        <MemberIdentity member={membership.member} />
        <WorkflowPicker workflows={workflows} selected={workflowIds} onChange={setWorkflowIds} />
        <div className="flex justify-end">
          <Button type="submit" isLoading={loading} disabled={workflowIds.size === 0}>
            Save access
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}

export function AgentMembers({
  organisationId,
  agentId,
  workflows,
  createdBy,
  canManageMembers,
}: {
  organisationId: string
  agentId: string
  workflows: NamedWorkflow[]
  createdBy?: Member | null
  canManageMembers: boolean
}) {
  const { data, loading, error, refetch } = useQuery(GetAgentMemberships, {
    variables: { organisationId, agentId },
    skip: !canManageMembers,
    fetchPolicy: 'cache-and-network',
  })
  const [removeMember] = useMutation(RemoveAgentMemberOp)
  const memberships: Membership[] = (data?.agentMemberships || []).filter(Boolean)

  if (!canManageMembers) {
    return (
      <div className="space-y-3">
        {createdBy && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-500/20 bg-neutral-500/[0.03] p-3">
            <MemberIdentity member={createdBy} />
            <AgentBadge>Creator</AgentBadge>
          </div>
        )}
        <div className="flex items-start gap-2 rounded-lg bg-neutral-500/5 p-3 text-xs text-neutral-500">
          <FaUsers className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>Only organisation owners and admins can view or change Agent assignments.</span>
        </div>
      </div>
    )
  }

  if (loading && !data) return <AgentLoading />
  if (error) return <AgentError message={error.message} retry={() => refetch()} />

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Agent access</h3>
          <p className="mt-1 text-xs text-neutral-500">
            Assigned members can use only the workflows selected below. Organisation owners and
            admins always retain access.
          </p>
        </div>
        {canManageMembers && workflows.length > 0 && (
          <AddAgentMemberDialog
            organisationId={organisationId}
            agentId={agentId}
            workflows={workflows}
            memberships={memberships}
          />
        )}
      </div>

      {createdBy && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-500/20 bg-neutral-500/[0.03] p-3">
          <div className="min-w-0">
            <MemberIdentity member={createdBy} />
            <p className="mt-1 text-2xs text-neutral-500">
              Creation attribution; runtime access is governed below.
            </p>
          </div>
          <AgentBadge>Creator</AgentBadge>
        </div>
      )}

      {memberships.length === 0 ? (
        <AgentEmpty
          title="No explicit member assignments"
          subtitle="Organisation owners and admins still have access to this Agent."
        />
      ) : (
        <div className="divide-y divide-neutral-500/20 overflow-hidden rounded-xl border border-neutral-500/20">
          {memberships.map((membership) => (
            <div
              key={membership.id}
              className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-2">
                <MemberIdentity member={membership.member} />
                <div className="flex flex-wrap gap-1">
                  {membership.workflows.map((workflow) => (
                    <AgentBadge key={workflow.id}>{workflow.name}</AgentBadge>
                  ))}
                </div>
              </div>
              {canManageMembers && (
                <div className="flex shrink-0 items-center gap-1">
                  <EditAgentMemberDialog membership={membership} workflows={workflows} />
                  <ConfirmAgentAction
                    title="Remove Agent member"
                    description={`Remove ${displayName(membership.member)} from this Agent? Their tokens and active sessions for these workflows will stop working.`}
                    actionLabel="Remove"
                    triggerContent={
                      <>
                        <FaTrash /> Remove
                      </>
                    }
                    onConfirm={async () => {
                      await removeMember({
                        variables: { membershipId: membership.id },
                        refetchQueries: ['GetAgentMemberships', 'GetAgentDetail', 'GetAgents'],
                        awaitRefetchQueries: true,
                      })
                      toast.success('Member removed from Agent')
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
