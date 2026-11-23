'use client'

import { useState } from 'react'
import { Button } from '@/components/common/Button'
import { FaEdit } from 'react-icons/fa'
import { AppDescriptionViewer } from '@/components/apps/AppDescriptionViewer'
import { AppDescriptionForm } from '@/components/apps/AppDescriptionForm'

import { AppType } from '@/apollo/graphql'

interface AppDescriptionEditorProps {
  app: AppType
  canUpdate: boolean
}

export const AppDescriptionEditor = ({ app, canUpdate }: AppDescriptionEditorProps) => {
  const [isEditing, setIsEditing] = useState(false)
  const description = app.description || ''

  return (
    <div className="space-y-6 py-4">
      <div>
        <h3 className="font-semibold text-lg">App README</h3>
        <p className="text-neutral-500 text-sm">App description and documentation</p>
      </div>

      {!isEditing ? (
        <div className="relative group">
          {description ? (
            <AppDescriptionViewer description={description} />
          ) : (
            <div className="italic text-neutral-500 p-4 border border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg">
              No description provided
            </div>
          )}

          {canUpdate && (
            <>
              {!description ? (
                <div className="mt-2">
                  <Button variant="secondary" icon={FaEdit} onClick={() => setIsEditing(true)}>
                    Add Description
                  </Button>
                </div>
              ) : (
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                  <Button variant="secondary" icon={FaEdit} onClick={() => setIsEditing(true)}>
                    Edit
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <AppDescriptionForm
          appId={app.id}
          initial={description}
          onSaved={() => setIsEditing(false)}
          onCancel={() => setIsEditing(false)}
        />
      )}
    </div>
  )
}
