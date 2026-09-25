import { EnvironmentType, SecretType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { Textarea } from '@/components/common/TextArea'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import {
  ConflictSelectionMap,
  EnvConflict,
  envFilePlaceholder,
  groupEnvConflicts,
  parseEnvEntries,
  processEnvFile,
} from '@/utils/secrets'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import EnvFileDropZone from './EnvFileDropZone'
import EnvConflictResolution from './EnvConflictResolution'

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
    const [step, setStep] = useState<'input' | 'resolve-conflicts'>('input')
    const [conflicts, setConflicts] = useState<EnvConflict[]>([])
    const [selections, setSelections] = useState<ConflictSelectionMap>({})

    const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

    const openModal = () => dialogRef.current?.openModal()
    const closeModal = () => dialogRef.current?.closeModal()

    const reset = () => {
      setEnvFileString('')
      setWithValues(true)
      setWithComments(true)
      setStep('input')
      setConflicts([])
      setSelections({})
    }

    const finishImport = (
      conflictSelections: ConflictSelectionMap,
      envFileStringToImport: string = envFileString
    ) => {
      const newSecrets: SecretType[] = processEnvFile(
        envFileStringToImport,
        environment,
        path,
        withValues,
        withComments,
        conflictSelections
      )

      if (newSecrets.length) {
        addSecrets(newSecrets)
        if (dialogRef.current) dialogRef.current.closeModal()
      }
    }

    const prepareImport = (envFileStringToImport: string, openOnConflict = false) => {
      const parsedEnvEntries = parseEnvEntries(envFileStringToImport)
      const allConflicts = groupEnvConflicts(parsedEnvEntries)
      const differingConflicts = allConflicts.filter((conflict) => conflict.hasDifferentValues)

      if (!differingConflicts.length) {
        finishImport({}, envFileStringToImport)
        return
      }

      setEnvFileString(envFileStringToImport)
      setConflicts(differingConflicts)
      setSelections({})
      setStep('resolve-conflicts')
      if (openOnConflict) openModal()
    }

    useImperativeHandle(ref, () => ({
      openModal,
      closeModal,
      importSource: (envFileStringToImport: string) =>
        prepareImport(envFileStringToImport, true),
    }))

    const processImport = () => prepareImport(envFileString)

    const continueImport = () => finishImport(selections)

    const handleFileSelection = (fileString: string) => setEnvFileString(fileString)

    return (
      <GenericDialog
        title="Import secrets"
        dialogTitle={
          <h3 className="text-sm font-medium leading-6 text-zinc-800 dark:text-zinc-200">
            {step === 'resolve-conflicts' ? 'Resolve duplicate secrets' : 'Import secrets'}
          </h3>
        }
        buttonVariant="secondary"
        ref={dialogRef}
        onClose={reset}
      >
        {step === 'resolve-conflicts' ? (
          <EnvConflictResolution
            conflicts={conflicts}
            selections={selections}
            onSelectionsChange={setSelections}
            onBack={() => setStep('input')}
            onContinue={continueImport}
          />
        ) : (
        <div className="space-y-2">
          <p className="text-neutral-500 text-sm">
            Drop, select or paste your .env here to import secrets into your environment
          </p>

          <div className="py-4 space-y-4">
            <div>
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
            <div>
              {envFileString && (
                <div className="flex flex-col w-48 gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      className="block text-neutral-600 dark:text-neutral-400 text-sm mb-2"
                      htmlFor="role"
                    >
                      Import values
                    </label>
                      <ToggleSwitch
                        value={withValues}
                        onToggle={() => setWithValues(!withValues)}
                      />
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
            </div>
            <Button variant="primary" onClick={processImport} disabled={!envFileString}>
              Preview Import
            </Button>
          </div>
        </div>
        )}
      </GenericDialog>
    )
  }
)

SingleEnvImportDialog.displayName = 'SingleEnvImportDialog'

export default SingleEnvImportDialog
