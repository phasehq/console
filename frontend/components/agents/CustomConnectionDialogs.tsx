'use client'

import { FormEvent, ReactNode, useId, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { FaCheck, FaEdit, FaKey, FaPlus, FaSyncAlt } from 'react-icons/fa'
import { toast } from 'react-toastify'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { ConfirmAgentAction } from '@/components/agents/AgentDialogs'
import {
  CustomConnectionFields,
  SecretFieldInputs,
  editorProblem,
  useCustomConnectionEditor,
} from '@/components/agents/CustomConnectionForm'
import {
  CreateCustomAgentConnectionOp,
  RotateCustomAgentConnectionKeyOp,
  UpdateCustomAgentConnectionOp,
  UpdateCustomAgentConnectionSecretOp,
} from '@/graphql/mutations/agents/manageAgentAssets.gql'
import GetServerKey from '@/graphql/queries/syncing/getServerKey.gql'
import {
  HTTP_LIMITS,
  describeHttpHost,
  describeHttpInjection,
  parseHttpDefinition,
  type HttpDefinition,
} from '@/utils/agents/httpDefinition'
import {
  customConnectionFormFromDefinition,
  emptyCustomConnectionForm,
  sameDefinition,
} from '@/utils/agents/customConnectionForm'
import {
  newCustomConnectionMaterial,
  sealCustomConnectionValue,
  secretsProblem,
} from '@/utils/agents/customConnectionSealing'

type DialogHandle = { openModal: () => void; closeModal: () => void }

export type CustomConnection = {
  id: string
  name: string
  serviceType: string
  definition?: unknown
  encryptionPublicKey?: string | null
  keyVersion?: number | null
  valueRevision?: number | null
  valueUpdatedAt?: string | null
  valueUpdatedBy?: { id: string; fullName?: string | null; email?: string | null } | null
  serverReadable?: boolean | null
}

const CONNECTION_QUERIES = ['GetAgentAssets', 'GetAgentDetail', 'GetAgentMesh']

const failureMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : fallback

const Failure = ({ message }: { message: string }) =>
  message ? (
    <div role="alert">
      <Alert variant="danger" icon size="sm">
        <span className="text-xs">{message}</span>
      </Alert>
    </div>
  ) : null

/** Hosts and where each secret goes, for a list row or a review. */
export function CustomConnectionSummary({ definition }: { definition: HttpDefinition }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
      <div className="min-w-0">
        <dt className="text-neutral-500">Allowed hosts</dt>
        <dd className="mt-1 space-y-0.5">
          {definition.hosts.map((rule) => (
            <code key={describeHttpHost(rule)} className="block break-all">
              {describeHttpHost(rule)}
            </code>
          ))}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-neutral-500">Secret goes in</dt>
        <dd className="mt-1 space-y-0.5">
          {definition.injections.map((injection, index) => (
            <code key={index} className="block break-all">
              {describeHttpInjection(injection, definition)}
            </code>
          ))}
          {definition.allowPlainHttp && (
            <span className="block text-amber-700 dark:text-amber-400">Plain HTTP allowed</span>
          )}
        </dd>
      </div>
    </dl>
  )
}

/**
 * The body of the Create Connection dialog once "Custom HTTP" is picked.
 * `serviceSelect` is the dialog's own service picker, kept above the form.
 */
export function CreateCustomConnectionForm({
  organisationId,
  initialName,
  onNameChange,
  serviceSelect,
  onCreated,
}: {
  organisationId: string
  initialName: string
  /** Keeps the dialog's own name in step, so it survives a change of service. */
  onNameChange?: (name: string) => void
  serviceSelect: ReactNode
  onCreated: () => void
}) {
  const id = useId()
  const editor = useCustomConnectionEditor(null, () => emptyCustomConnectionForm(initialName))
  const [failure, setFailure] = useState('')
  const [working, setWorking] = useState(false)
  const [create] = useMutation(CreateCustomAgentConnectionOp)
  const { data: serverKeyData } = useQuery(GetServerKey)
  const serverPublicKey: string = serverKeyData?.serverPublicKey || ''
  const problem = editorProblem(editor, true)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFailure('')
    const { definition } = editor.built
    if (!definition) return
    setWorking(true)
    try {
      const refused = secretsProblem(definition, editor.enteredSecrets)
      if (refused) throw new Error(refused)
      const material = await newCustomConnectionMaterial(
        definition,
        editor.enteredSecrets,
        serverPublicKey
      )
      await create({
        variables: {
          organisationId,
          name: editor.form.name.trim(),
          definition,
          ...material,
        },
        refetchQueries: CONNECTION_QUERIES,
        awaitRefetchQueries: true,
      })
      editor.reset(emptyCustomConnectionForm())
      toast.success('Connection created')
      onCreated()
    } catch (error) {
      setFailure(failureMessage(error, 'Could not create the Connection'))
    } finally {
      setWorking(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Input
        id={`${id}-name`}
        label="Connection name"
        value={editor.form.name}
        setValue={(value) => {
          editor.change({ ...editor.form, name: value })
          onNameChange?.(value)
        }}
        maxLength={HTTP_LIMITS.connectionName}
        required
      />
      {serviceSelect}
      <CustomConnectionFields idPrefix={id} editor={editor} askSecrets showName={false} />
      <p className="text-xs text-neutral-500">
        The secret is encrypted in your browser with a key made for this Connection. Agents only
        ever receive a placeholder.
      </p>
      <Failure message={failure} />
      <div className="flex justify-end">
        <Button
          type="submit"
          icon={FaPlus}
          isLoading={working}
          disabled={!!problem || !serverPublicKey}
          title={problem || undefined}
        >
          Create Connection
        </Button>
      </div>
    </form>
  )
}

/** Edit a custom Connection's name and definition. */
export function EditCustomConnectionDialog({
  connection,
  onOpen,
}: {
  connection: CustomConnection
  /** Lets the caller refresh the Connection, so a new secret is sealed to its current key. */
  onOpen?: () => void | Promise<unknown>
}) {
  const id = useId()
  const dialogRef = useRef<DialogHandle>(null)
  const current = useMemo(() => parseHttpDefinition(connection.definition), [connection.definition])
  const editor = useCustomConnectionEditor(current)
  const [editable, setEditable] = useState(true)
  const [name, setName] = useState(connection.name)
  const [failure, setFailure] = useState('')
  const [working, setWorking] = useState(false)
  const [update] = useMutation(UpdateCustomAgentConnectionOp)

  const begin = () => {
    setFailure('')
    setName(connection.name)
    const form = current ? customConnectionFormFromDefinition(connection.name, current) : null
    setEditable(!!form)
    editor.reset(form ?? emptyCustomConnectionForm(connection.name))
    void onOpen?.()
  }
  const end = () => {
    editor.clearSecrets()
    setFailure('')
  }

  const { definition } = editor.built
  const nextName = (editable ? editor.form.name : name).trim()
  const nameChanged = !!nextName && nextName !== connection.name
  const definitionChanged =
    editable && !!definition && !!current && !sameDefinition(definition, current)
  // Asked for as soon as the hosts or the set of secrets differ, even while a host is half-typed.
  const needSecrets = editable && editor.requirement.required
  const problem = editable ? editorProblem(editor, needSecrets) : nextName ? '' : 'Enter a name.'
  const changed = nameChanged || definitionChanged

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFailure('')
    if (!changed) {
      dialogRef.current?.closeModal()
      return
    }
    setWorking(true)
    try {
      let sealedValue: string | undefined
      if (needSecrets && definition) {
        const refused = secretsProblem(definition, editor.enteredSecrets)
        if (refused) throw new Error(refused)
        sealedValue = await sealCustomConnectionValue(
          definition,
          editor.enteredSecrets,
          connection.encryptionPublicKey || ''
        )
      }
      await update({
        variables: {
          connectionId: connection.id,
          ...(nameChanged ? { name: nextName } : {}),
          ...(definitionChanged ? { definition } : {}),
          ...(sealedValue ? { sealedValue } : {}),
        },
        refetchQueries: CONNECTION_QUERIES,
        awaitRefetchQueries: true,
      })
      editor.clearSecrets()
      toast.success('Connection updated')
      dialogRef.current?.closeModal()
    } catch (error) {
      setFailure(failureMessage(error, 'Could not save the Connection'))
    } finally {
      setWorking(false)
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title="Edit Custom HTTP Connection"
      size="md"
      buttonVariant="ghost"
      buttonContent="Edit"
      buttonProps={{ icon: FaEdit }}
      onOpen={begin}
      onClose={end}
    >
      <form onSubmit={submit} className="space-y-4 pt-4">
        {editable ? (
          <CustomConnectionFields
            idPrefix={id}
            editor={editor}
            askSecrets={needSecrets}
            secretReason={editor.requirement.reason}
          />
        ) : (
          <>
            <Input
              id={`${id}-name`}
              label="Connection name"
              value={name}
              setValue={setName}
              maxLength={HTTP_LIMITS.connectionName}
              required
            />
            {current && <CustomConnectionSummary definition={current} />}
            <Alert variant="info" icon size="sm">
              <span className="text-xs">
                This definition uses a shape this form cannot edit, so only the name can change
                here. Its secret and key can still be updated from the Connections list.
              </span>
            </Alert>
          </>
        )}
        <Failure message={failure} />
        <div className="flex justify-end">
          <Button
            type="submit"
            icon={FaCheck}
            isLoading={working}
            disabled={!!problem}
            title={problem || undefined}
          >
            Save Connection
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}

/** Replace a custom Connection's secret. The current one is never shown. */
export function UpdateCustomConnectionSecretDialog({
  connection,
  onOpen,
}: {
  connection: CustomConnection
  /** Lets the caller refresh the Connection, so the value is sealed to its current key. */
  onOpen?: () => void | Promise<unknown>
}) {
  const id = useId()
  const dialogRef = useRef<DialogHandle>(null)
  const definition = useMemo(
    () => parseHttpDefinition(connection.definition),
    [connection.definition]
  )
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState('')
  const [working, setWorking] = useState(false)
  const [updateSecret] = useMutation(UpdateCustomAgentConnectionSecretOp)
  const problem = definition
    ? secretsProblem(definition, secrets)
    : 'This Connection cannot be read.'

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFailure('')
    if (!definition) return
    setWorking(true)
    try {
      if (problem) throw new Error(problem)
      const sealedValue = await sealCustomConnectionValue(
        definition,
        secrets,
        connection.encryptionPublicKey || ''
      )
      await updateSecret({
        variables: { connectionId: connection.id, sealedValue },
        refetchQueries: CONNECTION_QUERIES,
        awaitRefetchQueries: true,
      })
      setSecrets({})
      toast.success('Connection secret updated')
      dialogRef.current?.closeModal()
    } catch (error) {
      setFailure(failureMessage(error, 'Could not update the secret'))
    } finally {
      setWorking(false)
    }
  }

  return (
    <GenericDialog
      ref={dialogRef}
      title={`Update the secret for ${connection.name}`}
      size="sm"
      buttonVariant="ghost"
      buttonContent="Update secret"
      buttonProps={{ icon: FaKey }}
      onOpen={() => {
        setSecrets({})
        setFailure('')
        void onOpen?.()
      }}
      onClose={() => {
        setSecrets({})
        setFailure('')
      }}
    >
      <form onSubmit={submit} className="space-y-4 pt-4">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Enter the new value. The stored one is never shown, and running sessions pick up the
          change without a restart.
        </p>
        {definition && (
          <SecretFieldInputs
            idPrefix={id}
            definition={definition}
            secrets={secrets}
            setSecrets={setSecrets}
          />
        )}
        <Failure message={failure} />
        <div className="flex justify-end">
          <Button type="submit" icon={FaKey} isLoading={working} disabled={!!problem}>
            Update secret
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}

/** Give a custom Connection a new encryption key, after a confirmation. */
export function RotateCustomConnectionKeyAction({ connection }: { connection: CustomConnection }) {
  const [rotate] = useMutation(RotateCustomAgentConnectionKeyOp)
  return (
    <ConfirmAgentAction
      title="Rotate encryption key"
      description={`Phase makes a new key for ${connection.name}, re-encrypts the stored secret under it and replaces every reader's copy of the key. The secret itself does not change, and nothing has to be entered again.`}
      actionLabel="Rotate key"
      danger={false}
      triggerProps={{ icon: FaSyncAlt }}
      onConfirm={async () => {
        await rotate({
          variables: { connectionId: connection.id },
          refetchQueries: CONNECTION_QUERIES,
          awaitRefetchQueries: true,
        })
        toast.success('Connection key rotated')
      }}
    />
  )
}
