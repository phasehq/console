'use client'

import { FormEvent, useId, useRef, useState } from 'react'
import { useMutation } from '@apollo/client'
import { FaCheck, FaEdit } from 'react-icons/fa'
import { toast } from 'react-toastify'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { Textarea } from '@/components/common/TextArea'
import { AgentTime } from '@/components/agents/AgentUI'
import { AgentRequestResolver } from '@/components/agents/AgentRequestResolver'
import { HardenedRequestMarkdown } from '@/components/agents/HardenedRequestMarkdown'
import { SetAgentWorkflowContextOp } from '@/graphql/mutations/agents/manageAgents.gql'
import { CONTEXT_MAX_LENGTH, contextProblem, isLongContext } from '@/utils/agents/workflowContext'

type ContextWorkflow = {
  id: string
  name: string
  contextMarkdown?: string | null
  contextUpdatedAt?: string | null
  contextUpdatedBy?: { id: string; fullName?: string | null; email?: string | null } | null
}

function EditContextDialog({ workflow }: { workflow: ContextWorkflow }) {
  const id = useId()
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const stored = workflow.contextMarkdown ?? ''
  const [text, setText] = useState(stored)
  const [failure, setFailure] = useState('')
  const [save, { loading }] = useMutation(SetAgentWorkflowContextOp)
  const problem = contextProblem(text, stored)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFailure('')
    if (problem) return
    try {
      await save({
        variables: { workflowId: workflow.id, markdown: text },
        refetchQueries: ['GetAgentDetail'],
        awaitRefetchQueries: true,
      })
      toast.success(text ? 'Context saved' : 'Context cleared')
      dialogRef.current?.closeModal()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Could not save the context')
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title={`Edit ${workflow.name} context`}
      size="md"
      buttonVariant="secondary"
      buttonContent="Edit"
      buttonProps={{ icon: FaEdit }}
      onOpen={() => {
        setText(stored)
        setFailure('')
      }}
    >
      <form onSubmit={submit} className="space-y-3 pt-4">
        <p className="text-xs text-neutral-500">
          Notes the Agent reads for this Workflow, written in Markdown. Do not put secrets here: the
          Agent can read all of it, and text that looks like a credential is refused.
        </p>
        <Textarea
          id={`${id}-context`}
          aria-label="Workflow context"
          rows={14}
          maxLength={CONTEXT_MAX_LENGTH}
          value={text}
          setValue={setText}
          spellCheck
        />
        <p className="text-right text-2xs text-neutral-500" aria-live="polite">
          {text.length.toLocaleString()} / {CONTEXT_MAX_LENGTH.toLocaleString()}
        </p>
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
            disabled={!!problem}
            title={problem || undefined}
          >
            Save context
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}

/**
 * The notes an Agent reads for a Workflow. The text is untrusted, so it is
 * shown only through the hardened Markdown component.
 */
export function WorkflowContext({
  workflow,
  canEdit,
}: {
  workflow: ContextWorkflow
  canEdit: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const markdown = workflow.contextMarkdown ?? ''
  const long = isLongContext(markdown)
  const collapsed = long && !expanded

  if (!markdown.trim()) {
    return (
      <section
        aria-label={`${workflow.name} context`}
        className="flex flex-col items-center gap-2 border-t border-neutral-500/10 px-4 py-4 text-center"
      >
        <p className="max-w-md text-xs text-neutral-500">
          Context is saved notes this Workflow&apos;s Agent reads, such as which repository to work
          in or how your team names things.
        </p>
        {canEdit && <EditContextDialog workflow={workflow} />}
      </section>
    )
  }

  return (
    <section
      aria-label={`${workflow.name} context`}
      className="space-y-2 border-t border-neutral-500/10 px-4 py-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-2xs font-semibold uppercase tracking-wider text-neutral-500">
            Context
          </h4>
          {workflow.contextUpdatedAt && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-2xs text-neutral-500">
              Updated <AgentTime value={workflow.contextUpdatedAt} />
              {workflow.contextUpdatedBy && (
                <>
                  by <AgentRequestResolver member={workflow.contextUpdatedBy} />
                </>
              )}
            </p>
          )}
        </div>
        {canEdit && <EditContextDialog workflow={workflow} />}
      </div>
      <div
        id={`${id}-text`}
        className={collapsed ? 'relative max-h-32 overflow-hidden' : undefined}
      >
        <HardenedRequestMarkdown text={markdown} />
        {collapsed && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-zinc-100 to-transparent dark:from-zinc-900"
          />
        )}
      </div>
      {long && (
        <Button
          type="button"
          variant="ghost"
          aria-expanded={expanded}
          aria-controls={`${id}-text`}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? 'Show less' : 'Show all'}
        </Button>
      )}
    </section>
  )
}
