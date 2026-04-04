import { forwardRef, useImperativeHandle, useRef } from 'react'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { ReferenceValidationError } from '@/utils/secretReferences'
import { SecretReferenceHighlight } from '@/components/secrets/SecretReferenceHighlight'

interface BrokenReferencesDialogProps {
  warnings: ReferenceValidationError[]
  onSaveAnyway: () => void
}

export const BrokenReferencesDialog = forwardRef<
  { openModal: () => void; closeModal: () => void },
  BrokenReferencesDialogProps
>(({ warnings, onSaveAnyway }, ref) => {
  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

  useImperativeHandle(ref, () => ({
    openModal: () => dialogRef.current?.openModal(),
    closeModal: () => dialogRef.current?.closeModal(),
  }))

  return (
    <GenericDialog title="Broken Secret References" ref={dialogRef} size="md">
      <div className="pt-4 space-y-4">
        <Alert variant="warning" icon size="sm">
          {warnings.length} broken reference{warnings.length !== 1 ? 's' : ''} found. These
          references may not resolve correctly at runtime.
        </Alert>
        <ul className="max-h-60 overflow-y-auto space-y-1.5">
          {warnings.map((err, i) => (
            <li
              key={i}
              className="p-1.5 rounded bg-zinc-100 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700"
            >
              <div className="text-2xs 2xl:text-xs">
                <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">{err.secretKey}</span>
                <span className="text-neutral-500"> in {err.envName}</span>
              </div>
              <div className="text-2xs 2xl:text-xs text-neutral-600 dark:text-neutral-400">
                <span className="font-mono"><SecretReferenceHighlight value={err.reference} /></span>: {err.error}
              </div>
            </li>
          ))}
        </ul>
        <div className="flex justify-between gap-2 pt-2">
          <Button variant="secondary" onClick={() => dialogRef.current?.closeModal()}>
            Go back
          </Button>
          <Button variant="warning" onClick={onSaveAnyway}>
            Deploy anyway
          </Button>
        </div>
      </div>
    </GenericDialog>
  )
})

BrokenReferencesDialog.displayName = 'BrokenReferencesDialog'
