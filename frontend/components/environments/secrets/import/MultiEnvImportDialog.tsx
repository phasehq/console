import { EnvironmentType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useFileDrop } from '@/hooks/useFileDrop'
import { AppSecret } from '@/app/[team]/apps/[app]/types'
import { ImportEnvOptions } from '@/utils/appSecrets'
import { envColor } from '@/utils/environment'
import { toast } from 'react-toastify'
import { EnvFileInput, readEnvFileInto } from './EnvFileInput'
import { EnvImportOptions, secretsForEnvs, useImportChoices } from './EnvImportOptions'

export type ImportDialogHandle = {
  openModal: () => void
  closeModal: () => void
  /** Opens on a .env file's contents, as though they had been pasted in */
  importFile: (file: File) => void
}

interface MultiEnvImportDialogProps {
  environments: EnvironmentType[]
  path?: string
  /** With each env's options: one that takes keys only keeps the values it already has */
  addSecrets: (secrets: AppSecret[], options: Record<string, ImportEnvOptions>) => void
}

const MultiEnvImportDialog = forwardRef(
  ({ environments, path = '/', addSecrets }: MultiEnvImportDialogProps, ref) => {
    const [envFileString, setEnvFileString] = useState('')
    // By id: a data refresh hands over new objects for the same environments
    const envIds = environments.map((env) => env.id)
    const {
      selectedIds,
      configs,
      toggleEnv,
      setConfig,
      reset: resetChoices,
    } = useImportChoices(envIds)

    const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

    const openModal = () => dialogRef.current?.openModal()
    const closeModal = () => dialogRef.current?.closeModal()

    const importFile = readEnvFileInto((text) => {
      setEnvFileString(text)
      openModal()
    })
    const { over, dropTarget } = useFileDrop(importFile)

    useImperativeHandle(ref, () => ({
      openModal,
      closeModal,
      importFile,
    }))

    const processImport = () => {
      const secretsByKey = new Map<string, AppSecret>()

      try {
        for (const { env, secrets } of secretsForEnvs(
          envFileString,
          environments,
          selectedIds,
          configs,
          path
        )) {
          secrets.forEach((secret) => {
            if (!secretsByKey.has(secret.key)) {
              secretsByKey.set(secret.key, {
                id: crypto.randomUUID(),
                isImported: true,
                key: secret.key,
                envs: [],
              })
            }
            secretsByKey.get(secret.key)?.envs.push({ env, secret })
          })
        }

        // Every row has a place for each environment, the ones left out too
        environments.forEach((env) => {
          secretsByKey.forEach((appSecret) => {
            if (!appSecret.envs.some((e) => e.env === env)) {
              appSecret.envs.push({ env, secret: null })
            }
          })
        })
      } catch (error) {
        secretsByKey.clear()
        toast.error((error as Error).message)
      }

      const newSecrets = Array.from(secretsByKey.values())

      if (newSecrets.length) {
        addSecrets(newSecrets, configs)
        setEnvFileString('') // Clear textarea after import
        if (dialogRef.current) dialogRef.current.closeModal()
      }
    }

    const reset = () => {
      setEnvFileString('')
      resetChoices()
    }

    // When the environments themselves change, not when a refresh re-creates their objects
    const envIdsKey = envIds.join(',')
    useEffect(() => {
      setEnvFileString('')
    }, [envIdsKey])

    const disabled = !envFileString || selectedIds.length === 0

    return (
      <GenericDialog title="Import secrets" ref={dialogRef} onClose={reset}>
        {/* A file dropped anywhere on the dialog lands in the box */}
        <div className="space-y-4" {...dropTarget}>
          <EnvFileInput
            value={envFileString}
            setValue={setEnvFileString}
            onFile={importFile}
            over={over}
          />

          {envFileString && (
            <>
              <hr className="border-neutral-500/40" />
              <EnvImportOptions
                environments={environments.map((env) => ({
                  id: env.id,
                  name: env.name,
                  color: envColor(env),
                }))}
                selectedIds={selectedIds}
                configs={configs}
                onToggleEnv={toggleEnv}
                onChangeConfig={setConfig}
              />
            </>
          )}

          <div className="flex justify-end">
            <Button variant="primary" onClick={processImport} disabled={disabled}>
              Preview Import
            </Button>
          </div>
        </div>
      </GenericDialog>
    )
  }
)

MultiEnvImportDialog.displayName = 'MultiEnvImportDialog'

export default MultiEnvImportDialog
