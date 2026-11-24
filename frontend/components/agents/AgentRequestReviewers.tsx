'use client'

import { useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { FaUserPlus } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { OrganisationMemberType } from '@/apollo/graphql'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import Spinner from '@/components/common/Spinner'
import { EnvAccessPicker } from '@/components/environments/EnvAccessPicker'
import { AgentRequestResolver } from '@/components/agents/AgentRequestResolver'
import { GetAgentRequestReviewerCandidates } from '@/graphql/queries/agents/getAgentRequestReviewerCandidates.gql'
import { SetAgentRequestReviewersOp } from '@/graphql/mutations/agents/setAgentRequestReviewers.gql'
import { toastUnhandledError } from '@/utils/errors'

// The server refuses more.
export const MAX_REQUEST_REVIEWERS = 10

type DialogHandle = { closeModal: () => void; openModal: () => void }
type ReviewerMember = {
  id: string
  fullName?: string | null
  email?: string | null
  avatarUrl?: string | null
}
export type AgentRequestReviewer = { id: string; member: ReviewerMember }

const NO_LOCKED_MEMBERS: ReadonlyMap<string, string> = new Map()

/** Chooses who is asked to review a pending request, from the members who could approve it. */
function AskForReviewDialog({
  requestId,
  organisationId,
  reviewers,
}: {
  requestId: string
  organisationId: string
  reviewers: AgentRequestReviewer[]
}) {
  const dialogRef = useRef<DialogHandle>(null)
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const { data, loading, error } = useQuery(GetAgentRequestReviewerCandidates, {
    variables: { organisationId, requestId },
    skip: !open,
    fetchPolicy: 'network-only',
  })
  const [setReviewers, { loading: saving }] = useMutation(SetAgentRequestReviewersOp)
  const candidates = (data?.agentRequestReviewerCandidates ?? []) as OrganisationMemberType[]
  // Someone asked earlier who can no longer approve stays on the list until unticked.
  const members = [
    ...candidates,
    ...reviewers
      .map((reviewer) => reviewer.member as OrganisationMemberType)
      .filter((member) => !candidates.some((candidate) => candidate.id === member.id)),
  ]
  const tooMany = selected.size > MAX_REQUEST_REVIEWERS
  const unchanged =
    selected.size === reviewers.length &&
    reviewers.every((reviewer) => selected.has(reviewer.member.id))

  const save = async () => {
    try {
      await setReviewers({ variables: { requestId, memberIds: Array.from(selected) } })
      toast.success(selected.size ? 'Reviewers saved' : 'Reviewers removed')
      dialogRef.current?.closeModal()
    } catch (saveError) {
      toastUnhandledError(saveError, 'The reviewers could not be saved')
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Ask for review"
      size="md"
      buttonVariant="secondary"
      buttonContent={reviewers.length ? 'Edit' : 'Ask for review'}
      buttonProps={{ icon: FaUserPlus, title: 'Ask members to review this request' }}
      onOpen={() => {
        setSelected(new Set(reviewers.map((reviewer) => reviewer.member.id)))
        setOpen(true)
      }}
      onClose={() => setOpen(false)}
    >
      <div className="space-y-4 pt-4">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Only members who could approve this request are listed. Asking puts it in front of them;
          anyone else who can approve it still can.
        </p>
        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner size="md" />
          </div>
        ) : error ? (
          <Alert variant="danger" icon size="sm">
            <span className="text-xs">{error.message}</span>
          </Alert>
        ) : members.length === 0 ? (
          <p className="py-4 text-center text-sm text-neutral-500">
            No member can approve this request.
          </p>
        ) : (
          <EnvAccessPicker
            members={members}
            serviceAccounts={[]}
            selectedIds={selected}
            lockedReasons={NO_LOCKED_MEMBERS}
            onChange={setSelected}
          />
        )}
        {tooMany && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            Ask at most {MAX_REQUEST_REVIEWERS} members.
          </p>
        )}
        <div className="flex justify-end">
          <Button
            variant="primary"
            isLoading={saving}
            disabled={loading || !!error || tooMany || unchanged}
            onClick={() => void save()}
          >
            Save
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
}

/** Who was asked to review a request, and, while it is pending, a way to change that. */
export function AgentRequestReviewers({
  requestId,
  organisationId,
  reviewers,
  pending,
}: {
  requestId: string
  organisationId: string
  reviewers: AgentRequestReviewer[]
  pending: boolean
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {reviewers.length > 0 ? (
        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5" aria-label="Reviewers">
          {reviewers.map((reviewer) => (
            <li key={reviewer.id} className="min-w-0 max-w-[12rem]">
              <AgentRequestResolver member={reviewer.member} />
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-neutral-500">No one asked</span>
      )}
      {pending && (
        <AskForReviewDialog
          requestId={requestId}
          organisationId={organisationId}
          reviewers={reviewers}
        />
      )}
    </div>
  )
}
