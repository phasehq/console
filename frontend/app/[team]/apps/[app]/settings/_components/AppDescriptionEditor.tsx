'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/common/Button'
import { toast } from 'react-toastify'
import { Textarea } from '@/components/common/TextArea'
import clsx from 'clsx'
import { FaEdit, FaInfo } from 'react-icons/fa'
import { useMutation } from '@apollo/client'
import { UpdateAppInfoOp } from '@/graphql/mutations/apps/updateAppInfo.gql'
import { AppDescriptionViewer } from '@/components/apps/AppDescriptionViewer'
import { MarkdownViewer } from '@/components/common/MarkdownViewer'

import { AppType } from '@/apollo/graphql'

interface AppDescriptionEditorProps {
  app: AppType
  canUpdate: boolean
}

export const AppDescriptionEditor = ({ app, canUpdate }: AppDescriptionEditorProps) => {
  const [description, setDescription] = useState(app.description || '')
  const [isEditing, setIsEditing] = useState(false)
  const [tab, setTab] = useState<'write' | 'preview'>('write')

  const searchParams = useSearchParams()

  const [updateAppInfo, { loading }] = useMutation(UpdateAppInfoOp)

  useEffect(() => {
    if (searchParams?.has('editDescription') && canUpdate) {
      setIsEditing(true)
    }
  }, [searchParams, canUpdate])

  useEffect(() => {
    if (!isEditing) {
      setDescription(app.description || '')
    }
  }, [app.description, isEditing])

  const saveDescription = async () => {
    try {
      await updateAppInfo({
        variables: {
          id: app.id,
          description,
        },
      })
      setIsEditing(false)
      toast.success('Updated app description!')
    } catch (error) {
      console.error(error)
      toast.error('Failed to update app description')
    }
  }

  return (
    <div className="space-y-6 py-4">
      <div className="text-neutral-500 text-sm flex items-center gap-2">
        <FaInfo /> App description and documentation{' '}
      </div>

      {!isEditing ? (
        <div className="relative group">
          {description ? (
            <AppDescriptionViewer appId={app.id} description={description} />
          ) : (
            <div className="italic text-neutral-500 p-4 border border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg">
              No description provided
            </div>
          )}

          {canUpdate && (
            <>
              {!description ? (
                <div className="mt-2">
                  <Button variant="secondary" onClick={() => setIsEditing(true)}>
                    <FaEdit /> <span className="ml-1">Add Description</span>
                  </Button>
                </div>
              ) : (
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                  <Button variant="secondary" onClick={() => setIsEditing(true)}>
                    <FaEdit /> <span className="ml-1">Edit</span>
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-700">
            <button
              onClick={() => setTab('write')}
              className={clsx(
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                tab === 'write'
                  ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
              )}
            >
              Write
            </button>
            <button
              onClick={() => setTab('preview')}
              className={clsx(
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                tab === 'preview'
                  ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                  : 'border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
              )}
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
                rows={8}
                maxLength={10000}
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
                description.length > 9500 ? 'text-amber-500' : 'text-neutral-400'
              )}
            >
              {description.length.toLocaleString()} / 10,000
            </span>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={saveDescription} isLoading={loading}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
