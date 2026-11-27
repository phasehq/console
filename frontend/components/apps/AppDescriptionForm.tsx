'use client'

import { useState } from 'react'
import clsx from 'clsx'
import { useMutation } from '@apollo/client'
import { toast } from 'react-toastify'
import { Button } from '@/components/common/Button'
import { Textarea } from '@/components/common/TextArea'
import { MarkdownViewer } from '@/components/common/MarkdownViewer'
import { UpdateAppInfoOp } from '@/graphql/mutations/apps/updateAppInfo.gql'

const MAX_LENGTH = 10000

const tabClass = (active: boolean) =>
  clsx(
    'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
    active
      ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
      : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
  )

type AppDescriptionFormProps = {
  appId: string
  initial: string
  rows?: number
  onSaved: (description: string) => void
  onCancel: () => void
}

/** Writes an App's README in Markdown, with a preview, and saves it */
export const AppDescriptionForm = ({
  appId,
  initial,
  rows = 8,
  onSaved,
  onCancel,
}: AppDescriptionFormProps) => {
  const [description, setDescription] = useState(initial)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [updateAppInfo, { loading }] = useMutation(UpdateAppInfoOp)

  const save = async () => {
    try {
      await updateAppInfo({ variables: { id: appId, description } })
      toast.success('Updated app description!')
      onSaved(description)
    } catch (error) {
      console.error(error)
      toast.error('Failed to update app description')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-700">
        <button type="button" onClick={() => setTab('write')} className={tabClass(tab === 'write')}>
          Write
        </button>
        <button
          type="button"
          onClick={() => setTab('preview')}
          className={tabClass(tab === 'preview')}
        >
          Preview
        </button>
      </div>

      <div className="min-h-[200px]">
        {tab === 'write' ? (
          <Textarea
            value={description}
            setValue={setDescription}
            placeholder="Enter app description (Markdown supported)..."
            rows={rows}
            maxLength={MAX_LENGTH}
            className="font-mono text-sm"
          />
        ) : (
          <div className="prose dark:prose-invert max-w-none p-4 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-800 min-h-[200px]">
            <MarkdownViewer text={description || '*No content*'} />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <span
          className={clsx(
            'text-xs font-mono',
            description.length > MAX_LENGTH - 500 ? 'text-amber-500' : 'text-neutral-400'
          )}
        >
          {description.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} isLoading={loading}>
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
