import { EnvironmentType, SecretType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { Textarea } from '@/components/common/TextArea'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { processEnvFile } from '@/utils/secrets'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import EnvFileDropZone from './EnvFileDropZone'

interface ImportSecretsDialogProps {
  environment: EnvironmentType
  path?: string
  addSecrets: (secrets: SecretType[]) => void
}

const ImportSecretsDialog = forwardRef(
  ({ environment, path = '/', addSecrets }: ImportSecretsDialogProps, ref) => {
    const [envFileString, setEnvFileString] = useState('')
    const [dragOver, setDragOver] = useState(false)
    const [withValues, setWithValues] = useState(true)
    const [withComments, setWithComments] = useState(true)

    const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

    const openModal = () => dialogRef.current?.openModal()
    const closeModal = () => dialogRef.current?.closeModal()

    useImperativeHandle(ref, () => ({
      openModal,
      closeModal,
    }))

    const processImport = () => {
      const newSecrets: SecretType[] = processEnvFile(
        envFileString,
        environment,
        path,
        withValues,
        withComments
      )

      if (newSecrets.length) {
        addSecrets(newSecrets)
        setEnvFileString('') // Clear textarea after import
        if (dialogRef.current) dialogRef.current.closeModal()
      }
    }

    const handleFileSelection = (fileString: string) => setEnvFileString(fileString)

    return (
      <GenericDialog title="Import secrets" buttonVariant="secondary" ref={dialogRef}>
        <div className="space-y-2">
          <p className="text-neutral-500">
            Drop, select or paste your .env here to import secrets into your environment
          </p>
          <EnvFileDropZone onFileProcessed={(content) => handleFileSelection(content)} />

          <div className="py-4">
            <Textarea
              value={envFileString}
              setValue={setEnvFileString}
              placeholder="# Paste.env here"
              rows={20}
              className="font-mono text-zinc-700 dark:text-zinc-300 text-sm placeholder:text-neutral-500/40"
            />
          </div>

          <div className="flex items-end justify-between">
            <div className="flex flex-col w-48 gap-2">
              <div className="flex items-center justify-between gap-2">
                <label
                  className="block text-neutral-600 dark:text-neutral-400 text-sm mb-2"
                  htmlFor="role"
                >
                  Include values
                </label>
                <ToggleSwitch value={withValues} onToggle={() => setWithValues(!withValues)} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <label
                  className="block text-neutral-600 dark:text-neutral-400 text-sm mb-2"
                  htmlFor="role"
                >
                  Include comments
                </label>
                <ToggleSwitch
                  value={withComments}
                  onToggle={() => setWithComments(!withComments)}
                />
              </div>
            </div>
            <Button variant="primary" onClick={processImport} disabled={!envFileString}>
              Import secrets
            </Button>
          </div>
        </div>
      </GenericDialog>
    )
  }
)

ImportSecretsDialog.displayName = 'ImportSecretsDialog'

export default ImportSecretsDialog
