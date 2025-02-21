import { EnvironmentType, SecretType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import GenericDialog from '@/components/common/GenericDialog'
import { Textarea } from '@/components/common/TextArea'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { duplicateKeysExist, envFilePlaceholder, processEnvFile } from '@/utils/secrets'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import EnvFileDropZone from './EnvFileDropZone'
import { AppSecret } from '@/app/[team]/apps/[app]/types'
import clsx from 'clsx'
import { toast } from 'react-toastify'

interface MultiEnvImportDialogProps {
  environments: EnvironmentType[]
  path?: string
  addSecrets: (secrets: AppSecret[]) => void
}

const MultiEnvImportDialog = forwardRef(
  ({ environments, path = '/', addSecrets }: MultiEnvImportDialogProps, ref) => {
    const [envFileString, setEnvFileString] = useState('')
    const [envConfigs, setEnvConfigs] = useState(
      environments.reduce(
        (acc, env, index) => {
          acc[env.id] = { withValues: index === 0, withComments: index === 0 }
          return acc
        },
        {} as Record<string, { withValues: boolean; withComments: boolean }>
      )
    )
    const [selectedEnvs, setSelectedEnvs] = useState<EnvironmentType[]>(environments)

    const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)

    const openModal = () => dialogRef.current?.openModal()
    const closeModal = () => dialogRef.current?.closeModal()

    useImperativeHandle(ref, () => ({
      openModal,
      closeModal,
    }))

    const handleToggleEnv = (env: EnvironmentType) => {
      setSelectedEnvs((prev) => {
        const newSelection = prev.includes(env)
          ? prev.filter((e) => e !== env) // Remove env
          : [...prev, env] // Add env

        // Reset envConfigs when the environment is unselected
        if (!newSelection.includes(env)) {
          setEnvConfigs((prevConfigs) => ({
            ...prevConfigs,
            [env.id]: { withValues: false, withComments: false },
          }))
        }

        return newSelection
      })
    }

    const processImport = () => {
      const secretsByKey = new Map<string, AppSecret>()

      try {
        environments.forEach((env) => {
          const secrets = selectedEnvs.includes(env)
            ? processEnvFile(
                envFileString,
                env,
                path,
                envConfigs[env.id].withValues,
                envConfigs[env.id].withComments
              )
            : []

          if (duplicateKeysExist(secrets)) {
            throw 'File contains duplicate keys!'
          }

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

          // Ensure the environment is included with a null secret if not selected
          if (!selectedEnvs.includes(env)) {
            secretsByKey.forEach((appSecret) => {
              appSecret.envs.push({ env, secret: null })
            })
          }
        })
      } catch (error) {
        toast.error(error as string)
      }

      const newSecrets = Array.from(secretsByKey.values())

      if (newSecrets.length) {
        addSecrets(newSecrets)
        setEnvFileString('') // Clear textarea after import
        if (dialogRef.current) dialogRef.current.closeModal()
      }
    }

    const handleFileSelection = (fileString: string) => setEnvFileString(fileString)

    const reset = () => {
      setEnvFileString('')
      setSelectedEnvs(environments)
      setEnvConfigs(
        environments.reduce(
          (acc, env, index) => {
            acc[env.id] = { withValues: index === 0, withComments: index === 0 }
            return acc
          },
          {} as Record<string, { withValues: boolean; withComments: boolean }>
        )
      )
    }

    // reset the component state if the environments are updated
    useEffect(() => {
      if (environments) {
        reset()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [environments])

    const disabled = !envFileString || selectedEnvs.length === 0

    return (
      <GenericDialog title="Import secrets" ref={dialogRef} onClose={reset}>
        <div className="space-y-4">
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

          {envFileString && (
            <>
              <hr className="border-neutral-500/40" />
              <table className="table-auto min-w-full divide-y divide-zinc-500/40 text-sm">
                <thead>
                  <tr className="bg-neutral-100 dark:bg-neutral-800 text-neutral-500">
                    <th className="border-b border-neutral-500/20 p-2 text-left">Environment</th>
                    <th className="border-b border-neutral-500/20 p-2 text-center">
                      Import Values
                    </th>
                    <th className="border-b border-neutral-500/20 p-2 text-center">
                      Import Comments
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-500/40">
                  {environments.map((env) => (
                    <tr key={env.id}>
                      <td>
                        <div
                          className="flex p-2 items-center justify-between border-r border-neutral-500/20"
                          title={
                            selectedEnvs.includes(env)
                              ? "Don't import secrets to this environment"
                              : 'Import secrets to this environment'
                          }
                        >
                          <span
                            className={clsx(
                              selectedEnvs.includes(env)
                                ? 'text-neutral-800 dark:text-neutral-200 font-medium'
                                : 'text-neutral-500'
                            )}
                          >
                            {env.name}
                          </span>

                          <ToggleSwitch
                            value={selectedEnvs.includes(env)}
                            onToggle={() => handleToggleEnv(env)}
                          />
                        </div>
                      </td>

                      <td>
                        <div className="flex p-2 items-center justify-center">
                          <ToggleSwitch
                            value={envConfigs[env.id].withValues}
                            onToggle={() =>
                              setEnvConfigs((prev) => ({
                                ...prev,
                                [env.id]: {
                                  ...prev[env.id],
                                  withValues: !prev[env.id].withValues,
                                },
                              }))
                            }
                          />
                        </div>
                      </td>

                      <td>
                        <div className="flex p-2 items-center justify-center">
                          <ToggleSwitch
                            value={envConfigs[env.id].withComments}
                            onToggle={() =>
                              setEnvConfigs((prev) => ({
                                ...prev,
                                [env.id]: {
                                  ...prev[env.id],
                                  withComments: !prev[env.id].withComments,
                                },
                              }))
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
