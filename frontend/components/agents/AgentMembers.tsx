'use client'

import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useApolloClient, useMutation, useQuery } from '@apollo/client'
import { Popover } from '@headlessui/react'
import clsx from 'clsx'
import { FaCheck, FaChevronDown, FaEdit, FaPlus, FaSearch, FaTimes } from 'react-icons/fa'
import { toast } from 'react-toastify'
import type { OrganisationMemberType, RoleType } from '@/apollo/graphql'
import { Alert } from '@/components/common/Alert'
import { Avatar } from '@/components/common/Avatar'
import { Button } from '@/components/common/Button'
import { Checkbox } from '@/components/common/Checkbox'
import GenericDialog from '@/components/common/GenericDialog'
import { RoleLabel } from '@/components/users/RoleLabel'
import GetOrganisationMembers from '@/graphql/queries/organisation/getOrganisationMembers.gql'
import { GetAgentMemberships } from '@/graphql/queries/agents/getAgentMemberships.gql'
import {
  AssignAgentMemberOp,
  RemoveAgentMemberOp,
  UpdateAgentMemberWorkflowsOp,
} from '@/graphql/mutations/agents/manageAgents.gql'
import { ConfirmAgentAction } from '@/components/agents/AgentDialogs'
import {
  AgentBadge,
  AgentEmpty,
  AgentError,
  AgentLoading,
  agentCardSurface,
} from '@/components/agents/AgentUI'
import { userHasGlobalAccess } from '@/utils/access/permissions'
import { toastUnhandledError } from '@/utils/errors'

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
}

type DialogHandle = { closeModal: () => void }

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

/** Workflow rows with round checkboxes; a click anywhere on a row toggles it. */
function WorkflowChecklist({
  workflows,
  selected,
  onToggle,
  className,
}: {
  workflows: NamedWorkflow[]
  selected: Set<string>
  onToggle: (workflowId: string) => void
  className?: string
}) {
  return (
    <div className={clsx('divide-y divide-neutral-500/20 overflow-y-auto', className)}>
      {workflows.map((workflow) => (
        // A label, so a click anywhere on the row toggles its checkbox.
        <label
          key={workflow.id}
          className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 hover:bg-neutral-500/5"
        >
          <span className="min-w-0 truncate text-xs font-medium">{workflow.name}</span>
          <Checkbox
            size="sm"
            checked={selected.has(workflow.id)}
            onChange={() => onToggle(workflow.id)}
          />
        </label>
      ))}
    </div>
  )
}

const toggled = (selected: Set<string>, workflowId: string) => {
  const next = new Set(selected)
  if (next.has(workflowId)) next.delete(workflowId)
  else next.add(workflowId)
  return next
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
  return (
    <fieldset>
      <legend className="mb-2 text-xs text-neutral-500">Workflow access *</legend>
      <WorkflowChecklist
        workflows={workflows}
        selected={selected}
        onToggle={(workflowId) => onChange(toggled(selected, workflowId))}
        className="max-h-56 rounded-lg border border-neutral-500/20"
      />
      <p className="mt-1.5 text-2xs text-neutral-500">
        Select at least one Workflow. Tokens and runtime access are restricted to these Workflows.
      </p>
    </fieldset>
  )
}

/** A member's Workflows in a dropdown, with the same rows as the inline picker. */
function WorkflowSelect({
  workflows,
  value,
  onChange,
  label,
}: {
  workflows: NamedWorkflow[]
  value: string[]
  onChange: (workflowIds: string[]) => void
  label: string
}) {
  const selected = new Set(value)
  const names = workflows
    .filter((workflow) => selected.has(workflow.id))
    .map((workflow) => workflow.name)

  return (
    <Popover className="relative">
      {({ open }) => (
        <>
          <Popover.Button
            aria-label={label}
            className={clsx(
              'flex min-h-9 w-full items-center justify-between gap-2 rounded-lg border border-neutral-500/20 px-3 py-2 text-left text-xs font-medium transition ease hover:bg-neutral-500/5 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500',
              names.length ? 'text-zinc-900 dark:text-zinc-100' : 'text-neutral-500'
            )}
          >
            <span className="truncate">
              {names.length ? names.join(' + ') : 'Select Workflows'}
            </span>
            <FaChevronDown
              aria-hidden="true"
              className={clsx(
                'shrink-0 text-neutral-500 transition ease',
                open ? '-rotate-180' : 'rotate-0'
              )}
            />
          </Popover.Button>
          <Popover.Panel className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-neutral-500/20 bg-neutral-100 shadow-lg dark:bg-neutral-900">
            <WorkflowChecklist
              workflows={workflows}
              selected={selected}
              onToggle={(workflowId) => {
                const next = toggled(selected, workflowId)
                // Keep the Workflows' own order, whatever order they were picked in.
                onChange(workflows.map((workflow) => workflow.id).filter((id) => next.has(id)))
              }}
              className="max-h-56"
            />
          </Popover.Panel>
        </>
      )}
    </Popover>
  )
}

/** A Popover, not a Menu, so the search input keeps its own keyboard handling. */
function MemberPicker({
  members,
  disabled,
  label,
  onSelect,
  openOnMount = false,
}: {
  members: Member[]
  disabled: boolean
  label: string
  onSelect: (member: Member) => void
  openOnMount?: boolean
}) {
  const [query, setQuery] = useState('')
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!openOnMount) return
    // After the dialog's own initial focus, so the search box keeps focus.
    const frame = requestAnimationFrame(() => buttonRef.current?.click())
    return () => cancelAnimationFrame(frame)
    // Only when the dialog opens, not each time the list changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const search = query.trim().toLowerCase()
  const matches = members.filter((member) =>
    `${member.fullName || ''} ${member.email || ''}`.toLowerCase().includes(search)
  )

  return (
    <Popover className="relative w-full max-w-96">
      {({ close }) => (
        <>
          <Popover.Button as={Fragment}>
            <Button
              ref={buttonRef}
              type="button"
              variant="secondary"
              icon={FaPlus}
              disabled={disabled}
            >
              {label}
            </Button>
          </Popover.Button>
          <Popover.Panel className="absolute left-0 z-20 mt-1 w-full overflow-hidden rounded-lg border border-neutral-500/20 bg-neutral-100 shadow-lg dark:bg-neutral-900">
            <div className="flex items-center gap-2 border-b border-neutral-500/20 px-3">
              <FaSearch aria-hidden="true" className="shrink-0 text-neutral-500" />
              <input
                autoFocus
                aria-label="Search members"
                placeholder="Search members"
                className="custom w-full bg-transparent py-2 text-sm text-zinc-900 focus:outline-none dark:text-zinc-100"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="max-h-72 divide-y divide-neutral-500/20 overflow-y-auto">
              {matches.length ? (
                matches.map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition ease hover:bg-neutral-500/5 focus:bg-neutral-500/5 focus:outline-none"
                    onClick={() => {
                      onSelect(member)
                      setQuery('')
                      close()
                    }}
                  >
                    <MemberIdentity member={member} />
                    {member.role && <RoleLabel role={member.role as RoleType} />}
                  </button>
                ))
              ) : (
                <p className="p-4 text-center text-sm text-neutral-500">
                  {search ? `No members match "${query.trim()}"` : 'Everyone eligible is added'}
                </p>
              )}
            </div>
          </Popover.Panel>
        </>
      )}
    </Popover>
  )
}

type Assignment = { member: Member; workflowIds: string[] }

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
  const client = useApolloClient()
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [saving, setSaving] = useState(false)
  const { data, loading: loadingMembers } = useQuery(GetOrganisationMembers, {
    variables: { organisationId, role: null },
  })
  const [assignMember] = useMutation(AssignAgentMemberOp)
  const existingIds = useMemo(
    () => new Set(memberships.map((membership) => membership.member.id)),
    [memberships]
  )
  const eligibleMembers: Member[] = (data?.organisationMembers || []).filter(
    (member: Member | null): member is Member =>
      !!member &&
      !existingIds.has(member.id) &&
      !userHasGlobalAccess(member.role?.permissions || '')
  )
  const pickedIds = new Set(assignments.map((assignment) => assignment.member.id))
  const unpicked = eligibleMembers.filter((member) => !pickedIds.has(member.id))
  const incomplete = assignments.some((assignment) => assignment.workflowIds.length === 0)

  const setWorkflows = (memberId: string, workflowIds: string[]) =>
    setAssignments((current) =>
      current.map((assignment) =>
        assignment.member.id === memberId ? { ...assignment, workflowIds } : assignment
      )
    )

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!assignments.length || incomplete) return
    setSaving(true)
    const assigned = new Set<string>()
    try {
      // One at a time, so a failure leaves only the unassigned rows to retry.
      for (const { member, workflowIds } of assignments) {
        await assignMember({ variables: { agentId, memberId: member.id, workflowIds } })
        assigned.add(member.id)
      }
      toast.success(
        assignments.length === 1
          ? 'Member assigned to Agent'
          : `${assignments.length} members assigned to Agent`
      )
      dialogRef.current?.closeModal()
    } catch (error) {
      setAssignments((current) =>
        current.filter((assignment) => !assigned.has(assignment.member.id))
      )
      toastUnhandledError(error, 'The Agent membership could not be updated')
    } finally {
      setSaving(false)
      if (assigned.size) {
        await client.refetchQueries({
          include: ['GetAgentMemberships', 'GetAgentDetail', 'GetAgents'],
        })
      }
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Assign members"
      size="lg"
      buttonContent="Assign members"
      buttonProps={{ icon: FaPlus, disabled: loadingMembers || eligibleMembers.length === 0 }}
      onClose={() => setAssignments([])}
    >
      <form onSubmit={submit} className="space-y-6 pt-4">
        <p className="text-sm text-neutral-500">
          Select members, then the Workflows each one can use. Tokens and runtime access are
          restricted to these Workflows.
        </p>

        {assignments.length > 0 && (
          <div className="space-y-2">
            <div className="hidden items-center gap-4 sm:flex">
              <div className="w-1/2 text-2xs font-medium uppercase tracking-wider text-gray-500">
                Member
              </div>
              <div className="w-1/2 text-2xs font-medium uppercase tracking-wider text-gray-500">
                Workflows <span className="text-red-500">*</span>
              </div>
              <div className="w-10" />
            </div>
            {assignments.map(({ member, workflowIds }) => (
              <div
                key={member.id}
                className="flex flex-col gap-2 rounded-lg border border-neutral-500/20 p-2 sm:flex-row sm:items-center sm:gap-4 sm:border-0 sm:p-0"
              >
                <div className="flex w-full min-w-0 items-center justify-between gap-2 sm:w-1/2">
                  <MemberIdentity member={member} />
                  {member.role && <RoleLabel role={member.role as RoleType} />}
                </div>
                <div className="w-full sm:w-1/2">
                  <WorkflowSelect
                    workflows={workflows}
                    value={workflowIds}
                    onChange={(ids) => setWorkflows(member.id, ids)}
                    label={`Workflows for ${displayName(member)}`}
                  />
                </div>
                <Button
                  type="button"
                  variant="danger"
                  icon={FaTimes}
                  classString="!py-2.5"
                  title={`Remove ${displayName(member)}`}
                  aria-label={`Remove ${displayName(member)}`}
                  onClick={() =>
                    setAssignments((current) =>
                      current.filter((assignment) => assignment.member.id !== member.id)
                    )
                  }
                />
              </div>
            ))}
          </div>
        )}

        <MemberPicker
          members={unpicked}
          disabled={loadingMembers || unpicked.length === 0}
          openOnMount={!assignments.length && unpicked.length > 0}
          label={assignments.length ? 'Add another member' : 'Select a member'}
          onSelect={(member) =>
            setAssignments((current) => [
              ...current,
              // The Agent's default Workflow, as a starting point.
              { member, workflowIds: workflows[0] ? [workflows[0].id] : [] },
            ])
          }
        />

        <div className="flex items-center justify-between gap-4">
          <Button
            type="button"
            variant="secondary"
            icon={FaTimes}
            onClick={() => dialogRef.current?.closeModal()}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            icon={FaPlus}
            isLoading={saving}
            disabled={!assignments.length || incomplete}
          >
            {assignments.length > 1 ? `Assign ${assignments.length} members` : 'Assign member'}
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
      toastUnhandledError(error, 'The Agent membership could not be updated')
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title={`Edit ${displayName(membership.member)} access`}
      size="sm"
      buttonVariant="ghost"
      buttonContent="Edit"
      buttonProps={{ icon: FaEdit }}
      onClose={() => setWorkflowIds(currentIds())}
    >
      <form onSubmit={submit} className="space-y-4 pt-4">
        <MemberIdentity member={membership.member} />
        <WorkflowPicker workflows={workflows} selected={workflowIds} onChange={setWorkflowIds} />
        <div className="flex justify-end">
          <Button
            type="submit"
            icon={FaCheck}
            isLoading={loading}
            disabled={workflowIds.size === 0}
          >
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
  canReadMembers,
  canManageMembers,
}: {
  organisationId: string
  agentId: string
  workflows: NamedWorkflow[]
  canReadMembers: boolean
  canManageMembers: boolean
}) {
  const { data, loading, error, refetch } = useQuery(GetAgentMemberships, {
    variables: { organisationId, agentId },
    skip: !canReadMembers,
    fetchPolicy: 'cache-and-network',
  })
  const [removeMember] = useMutation(RemoveAgentMemberOp)
  const memberships: Membership[] = (data?.agentMemberships || []).filter(Boolean)

  if (!canReadMembers) {
    return (
      <Alert variant="info" icon size="sm">
        <span className="text-xs">
          You do not have permission to view this Agent&apos;s members.
        </span>
      </Alert>
    )
  }

  if (loading && !data) return <AgentLoading />
  if (error && !data) return <AgentError message={error.message} retry={() => refetch()} />

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold">Agent access</h3>
          <p className="mt-1 text-xs text-neutral-500">
            Members can use only their assigned Workflows. Organisation owners and admins always
            have access. Creating an Agent does not assign its creator.
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

      {memberships.length === 0 ? (
        <AgentEmpty
          title="No explicit member assignments"
          subtitle="Organisation owners and admins still have access to this Agent."
        />
      ) : (
        // A table like the app members page, with actions on row hover.
        <div className={clsx(agentCardSurface(), 'overflow-x-auto px-4')}>
          <table className="table-auto min-w-full divide-y divide-zinc-500/40 text-sm">
            <thead>
              <tr>
                <th className="py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Member
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                  Workflows
                </th>
                {canManageMembers && (
                  <th className="px-6 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-500/20">
              {memberships.map((membership) => (
                <tr key={membership.id} className="group">
                  <td className="py-2">
                    <MemberIdentity member={membership.member} />
                  </td>
                  <td className="px-6 py-2">
                    <div className="flex flex-wrap gap-1">
                      {membership.workflows.map((workflow) => (
                        <AgentBadge key={workflow.id}>{workflow.name}</AgentBadge>
                      ))}
                    </div>
                  </td>
                  {canManageMembers && (
                    <td className="px-6 py-2">
                      <div className="flex items-center justify-end gap-1 opacity-0 transition ease focus-within:opacity-100 group-hover:opacity-100">
                        <EditAgentMemberDialog membership={membership} workflows={workflows} />
                        <ConfirmAgentAction
                          title="Remove Agent member"
                          description={`Remove ${displayName(membership.member)} from this Agent? Their tokens and active sessions for these workflows will stop working.`}
                          actionLabel="Remove"
                          triggerVariant="danger"
                          triggerProps={{ icon: FaTimes }}
                          onConfirm={async () => {
                            await removeMember({
                              variables: { membershipId: membership.id },
                              refetchQueries: [
                                'GetAgentMemberships',
                                'GetAgentDetail',
                                'GetAgents',
                              ],
                              awaitRefetchQueries: true,
                            })
                            toast.success('Member removed from Agent')
                          }}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
