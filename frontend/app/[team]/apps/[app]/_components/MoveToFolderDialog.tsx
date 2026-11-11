'use client'

import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { FolderPicker } from './FolderPicker'

export type MoveToFolderDialogHandle = { openModal: () => void }

type MoveToFolderDialogProps = {
  /** Every folder of the App, as full paths */
  folders: string[]
  count: number
  onMove: (path: string) => void
}

/** Picks the folder the selected secrets move to; the move itself is staged like any other edit */
export const MoveToFolderDialog = forwardRef<MoveToFolderDialogHandle, MoveToFolderDialogProps>(
  function MoveToFolderDialog({ folders, count, onMove }, ref) {
    const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
    const [path, setPath] = useState<string | null>(null)

    useImperativeHandle(ref, () => ({
      openModal: () => {
        setPath(null)
        dialogRef.current?.openModal()
      },
    }))

    return (
      <GenericDialog
        ref={dialogRef}
        title={`Move ${count} secret${count === 1 ? '' : 's'} to a folder`}
        size="sm"
      >
        <div className="space-y-3 pt-3">
          <p className="text-xs text-neutral-500">
            They move in the environments shown, once deployed. References to them by path
            aren&apos;t rewritten.
          </p>

          <FolderPicker folders={folders} value={path} onChange={setPath} />

          <div className="flex items-center justify-between gap-4">
            <Button variant="secondary" type="button" onClick={() => dialogRef.current?.closeModal()}>
              Cancel
            </Button>
            <Button
              variant="primary"
              type="button"
              disabled={path === null}
              onClick={() => {
                onMove(path!)
                dialogRef.current?.closeModal()
              }}
            >
              Move
            </Button>
          </div>
        </div>
      </GenericDialog>
    )
  }
)
