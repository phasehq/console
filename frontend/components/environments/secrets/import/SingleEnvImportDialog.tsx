import { EnvironmentType, SecretType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { Textarea } from '@/components/common/TextArea'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { duplicateKeysExist, envFilePlaceholder, processEnvFile } from '@/utils/secrets'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import EnvFileDropZone from './EnvFileDropZone'
import { toast } from 'react-toastify'

interface SingleEnvImportDialogProps {
  environment: EnvironmentType
  path?: string
  addSecrets: (secrets: SecretType[]) => void
}

const SingleEnvImportDialog = forwardRef(
  ({ environment, path = '/', addSecrets }: SingleEnvImportDialogProps, ref) => {
    const [envFileString, setEnvFileString] = useState('')
    const [withValues, setWithValues] = useState(true)
    const [withComments, setWithComments] = useState(true)

    const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

    const openModal = () => dialogRef.current?.openModal()
    const closeModal = () => dialogRef.current?.closeModal()

    useImperativeHandle(ref, () => ({
      openModal,
      closeModal,
    }))

    const reset = () => {
      setEnvFileString('')
      setWithValues(true)
      setWithComments(true)
    }

    const processImport = () => {
      const newSecrets: SecretType[] = processEnvFile(
        envFileString,
        environment,
        path,
        withValues,
        withComments
      )

      if (duplicateKeysExist(newSecrets)) {
        toast.error('File contains duplicate keys!')
        return
      }

      if (newSecrets.length) {
        addSecrets(newSecrets)
        if (dialogRef.current) dialogRef.current.closeModal()
      }
    }

    const handleFileSelection = (fileString: string) => setEnvFileString(fileString)

    return (
      <GenericDialog
        title="Import secrets"
        buttonVariant="secondary"
        ref={dialogRef}
        onClose={reset}
      >
        <div className="space-y-2">
          <p className="text-neutral-500">
            Drop, select or paste your .env here to import secrets into your environment
          </p>

          <div>
            <div className="py-4">
              <Textarea
                value={envFileString}
                setValue={setEnvFileString}
                placeholder={envFilePlaceholder}
                rows={12}
                className="font-mono text-zinc-700 dark:text-zinc-300 text-sm placeholder:text-zinc-500"
              />
            </div>
            {!envFileString && (
              <EnvFileDropZone onFileProcessed={(content) => handleFileSelection(content)} />
            )}
          </div>

          <div className="flex items-end justify-between">
            {envFileString && (
              <div className="flex flex-col w-48 gap-2">
                <div className="flex items-center justify-between gap-2">
                  <label
                    className="block text-neutral-600 dark:text-neutral-400 text-sm mb-2"
                    htmlFor="role"
                  >
                    Import values
                  </label>
                  <ToggleSwitch value={withValues} onToggle={() => setWithValues(!withValues)} />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <label
                    className="block text-neutral-600 dark:text-neutral-400 text-sm mb-2"
                    htmlFor="role"
                  >
                    Import comments
                  </label>
                  <ToggleSwitch
                    value={withComments}
                    onToggle={() => setWithComments(!withComments)}
                  />
                </div>
              </div>
            )}
            <Button variant="primary" onClick={processImport} disabled={!envFileString}>
              Preview Import
            </Button>
          </div>
        </div>
      </GenericDialog>
    )
  }
)

SingleEnvImportDialog.displayName = 'SingleEnvImportDialog'

export default SingleEnvImportDialog
