'use client'

import { useRef, useState } from 'react'
import { FaBookOpen, FaEdit, FaPlus } from 'react-icons/fa'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { MarkdownViewer } from '@/components/common/MarkdownViewer'
import { AppDescriptionForm } from './AppDescriptionForm'

type AppReadmeButtonProps = {
  appId: string
  description: string
  canEdit: boolean
}

/** Opens the App's README, editable in place; without one, offers to write it */
export const AppReadmeButton = ({ appId, description, canEdit }: AppReadmeButtonProps) => {
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  const [editing, setEditing] = useState(false)

  if (!description && !canEdit) return null

  // Back to the README if there is one to go back to
  const leaveEditing = (current: string) =>
    current ? setEditing(false) : dialogRef.current?.closeModal()

  return (
    <GenericDialog
      ref={dialogRef}
      title={description ? 'View App README' : 'Add a README to describe this App'}
      dialogTitle={
        <div className="flex flex-1 items-center justify-between gap-4 pb-2">
          <div>
            <h3 className="font-semibold text-lg">App README</h3>
            <p className="text-neutral-500 text-sm">App description and documentation</p>
          </div>
          {canEdit && !editing && (
            <Button variant="secondary" icon={FaEdit} onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
        </div>
      }
      size="lg"
      buttonVariant={description ? 'secondary' : 'ghost'}
      buttonProps={{ icon: description ? FaBookOpen : FaPlus }}
      // A bare plus says nothing, so phones only get the button once there's a README to open
      buttonWrapperClass={description ? undefined : 'hidden sm:flex'}
      buttonContent={
        <span className="hidden sm:inline">{description ? 'README' : 'Add README'}</span>
      }
      onOpen={() => setEditing(!description)}
    >
      {editing ? (
        <AppDescriptionForm
          appId={appId}
          initial={description}
          rows={16}
          onSaved={leaveEditing}
          onCancel={() => leaveEditing(description)}
        />
      ) : (
        <div className="prose dark:prose-invert max-w-none">
          <MarkdownViewer text={description} />
        </div>
      )}
    </GenericDialog>
  )
}
