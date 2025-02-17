import { EnvironmentType, SecretType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { Textarea } from '@/components/common/TextArea'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'

interface ImportSecretsDialogProps {
  environment: EnvironmentType
  path?: string
  addSecrets: (secrets: SecretType[]) => void
}

const ImportSecretsDialog = forwardRef(
  ({ environment, path = '/', addSecrets }: ImportSecretsDialogProps, ref) => {
    const [envFile, setEnvFile] = useState('')
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
      const lines = envFile.split('\n')
      const newSecrets: SecretType[] = []
      let lastComment = ''

      lines.forEach((line) => {
        let trimmed = line.trim()
        if (!trimmed) return // Skip empty lines

        if (trimmed.startsWith('#')) {
          lastComment = trimmed.slice(1).trim()
          return
        }

        const [key, ...valueParts] = trimmed.split('=')
        if (!key) return // Skip malformed lines

        let valueWithComment = valueParts.join('=')
        let [parsedValue, inlineComment] = valueWithComment.split('#').map((part) => part.trim())

        let value = withValues ? parsedValue.replace(/^['"]|['"]$/g, '') : ''

        newSecrets.push({
          id: `new-${crypto.randomUUID()}`,
          updatedAt: null,
          version: 1,
          key: key.trim().toUpperCase(),
          value,
          tags: [],
          comment: withComments ? lastComment || inlineComment || '' : '',
          path,
          environment,
        })
        lastComment = '' // Reset lastComment after assigning it
      })

      if (newSecrets.length) {
        addSecrets(newSecrets)
        setEnvFile('') // Clear textarea after import
        if (dialogRef.current) dialogRef.current.closeModal()
      }
    }

    return (
      <GenericDialog title="Import secrets" buttonVariant="secondary" ref={dialogRef}>
        <div className="space-y-2">
          <p className="text-neutral-500">
            Paste your .env file here to import secrets into your environment
          </p>
          <div className="py-4">
            <Textarea
              value={envFile}
              setValue={setEnvFile}
              placeholder="FOO=BAR"
              rows={20}
              className="font-mono text-zinc-700 dark:text-zinc-300 text-sm"
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
            <Button variant="primary" onClick={processImport}>
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
