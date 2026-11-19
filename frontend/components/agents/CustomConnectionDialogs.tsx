'use client'

import { FormEvent, ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@apollo/client'
import { FaCheck, FaEdit, FaExternalLinkAlt, FaPlus } from 'react-icons/fa'
import { toast } from 'react-toastify'
import GenericDialog from '@/components/common/GenericDialog'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import {
  CustomConnectionFields,
  SecretFieldInputs,
  editorProblem,
  useCustomConnectionEditor,
} from '@/components/agents/CustomConnectionForm'
import {
  CreateCustomAgentConnectionOp,
  UpdateCustomAgentConnectionOp,
} from '@/graphql/mutations/agents/manageAgentAssets.gql'
import GetServerKey from '@/graphql/queries/syncing/getServerKey.gql'
import {
  HTTP_LIMITS,
  describeHttpHost,
  describeHttpInjection,
  parseHttpDefinition,
  secretFieldNames,
  type HttpDefinition,
} from '@/utils/agents/httpDefinition'
import {
  customConnectionFormFromDefinition,
  emptyCustomConnectionForm,
  sameDefinition,
} from '@/utils/agents/customConnectionForm'
import {
  presetForm,
  presetLocksHosts,
  scratchForm,
  type ConnectionPreset,
} from '@/utils/agents/connectionPresets'
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
  valueRevision?: number | null
  valueUpdatedAt?: string | null
  valueUpdatedBy?: { id: string; fullName?: string | null; email?: string | null } | null
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
  preset = null,
  onChangePreset,
  onNameChange,
  serviceSelect,
  onCreated,
}: {
  organisationId: string
  initialName: string
  /** The provider the form starts from; null for a blank form. */
  preset?: ConnectionPreset | null
  /** Goes back to the choice of provider. */
  onChangePreset?: () => void
  /** Keeps the dialog's own name in step, so it survives a change of service. */
  onNameChange?: (name: string) => void
  serviceSelect: ReactNode
  onCreated: () => void
}) {
  const id = useId()
  // A preset the form cannot express exactly is not applied: the member starts from scratch.
  const [prefilled] = useState(() => (preset ? presetForm(preset, initialName) : null))
  const editor = useCustomConnectionEditor(null, () => prefilled ?? scratchForm(initialName))
  const lockHosts = !!prefilled && presetLocksHosts(preset)
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
      {preset && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-neutral-500/20 bg-neutral-500/5 px-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">{preset.name}</p>
            <p className="text-xs text-neutral-500">{preset.description}</p>
            {preset.docsUrl && (
              <a
                href={preset.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-500 dark:text-emerald-400"
              >
                How to get a key
                <FaExternalLinkAlt aria-hidden="true" className="text-2xs" />
              </a>
            )}
            {!prefilled && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                This provider could not be filled in here. Define the Connection yourself.
              </p>
            )}
          </div>
          {onChangePreset && (
            <Button type="button" variant="ghost" onClick={onChangePreset}>
              Change
            </Button>
          )}
        </div>
      )}
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
      <CustomConnectionFields
        idPrefix={id}
        editor={editor}
        askSecrets
        showName={false}
        lockHosts={lockHosts}
        secretLabels={prefilled ? preset?.labels : undefined}
      />
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

/** Shown once one of several secrets is typed: the stored value holds them all together. */
const ALL_SECRETS_HINT =
  'The secrets of this Connection are stored together and cannot be read back. To change one, enter all of them.'

/**
 * Edit a custom Connection's name, definition and secret. The stored secret is never
 * read back; an untouched secret input keeps it.
 */
export function EditCustomConnectionDialog({
  connection,
  onOpen,
}: {
  connection: CustomConnection
  /** Lets the caller refresh the Connection, so the form starts from what is stored now. */
  onOpen?: () => void | Promise<unknown>
}) {
  const id = useId()
  const dialogRef = useRef<DialogHandle>(null)
  const current = useMemo(() => parseHttpDefinition(connection.definition), [connection.definition])
  const editor = useCustomConnectionEditor(current)
  const [editable, setEditable] = useState(true)
  const [name, setName] = useState(connection.name)
  // Secrets by field name, for a definition the form cannot edit.
  const [fieldSecrets, setFieldSecrets] = useState<Record<string, string>>({})
  const [failure, setFailure] = useState('')
  const [working, setWorking] = useState(false)
  const [update] = useMutation(UpdateCustomAgentConnectionOp)

  // What the form was last seeded from; null while the dialog is closed.
  const [seeded, setSeeded] = useState<{ name: string; definition: HttpDefinition | null } | null>(
    null
  )

  const seed = () => {
    setName(connection.name)
    setFieldSecrets({})
    const form = current ? customConnectionFormFromDefinition(connection.name, current) : null
    setEditable(!!form)
    editor.reset(form ?? emptyCustomConnectionForm(connection.name))
    setSeeded({ name: connection.name, definition: current })
  }
  const begin = () => {
    setFailure('')
    seed()
    void onOpen?.()
  }
  // Closing discards whatever was typed.
  const end = () => {
    editor.clearSecrets()
    setFieldSecrets({})
    setFailure('')
    setSeeded(null)
  }

  // The definition a save stores, and the one a new secret is sealed over.
  const definition = editable ? editor.built.definition : current
  const enteredSecrets = editable ? editor.enteredSecrets : fieldSecrets
  const nextName = (editable ? editor.form.name : name).trim()
  const nameChanged = !!nextName && nextName !== connection.name
  const definitionChanged =
    editable && !!definition && !!current && !sameDefinition(definition, current)
  // The hosts or the set of secrets differ, even while a host is half-typed: the
  // stored value no longer fits, so every secret is entered again.
  const rebound = editable && editor.requirement.required
  const secretsTyped = editable
    ? editor.secretsTyped
    : Object.values(fieldSecrets).some((value) => !!value)
  const needSecrets = rebound || secretsTyped
  const secretCount = editable
    ? Object.keys(editor.built.secretFields).length
    : current
      ? secretFieldNames(current).length
      : 0
  const secretHint = secretsTyped && !rebound && secretCount > 1 ? ALL_SECRETS_HINT : ''
  // The Connection moved on (a refetch landed) since the form was seeded from it.
  const moved =
    !!seeded &&
    (seeded.name !== connection.name ||
      (seeded.definition === null) !== (current === null) ||
      (!!seeded.definition && !!current && !sameDefinition(seeded.definition, current)))
  const pristine =
    !!seeded &&
    !secretsTyped &&
    (editable
      ? editor.form.name === seeded.name &&
        !!editor.built.definition &&
        !!seeded.definition &&
        sameDefinition(editor.built.definition, seeded.definition)
      : name === seeded.name)
  const reseeding = moved && pristine
  const changed = !reseeding && (nameChanged || definitionChanged || secretsTyped)
  const problem = editable
    ? editorProblem(editor, needSecrets)
    : !nextName
      ? 'Enter a name.'
      : needSecrets && current
        ? secretsProblem(current, fieldSecrets)
        : ''

  // Nothing edited yet: follow the refetched Connection. Edits are kept and flagged instead.
  useEffect(() => {
    if (reseeding) seed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reseeding, connection.name, current])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFailure('')
    if (!changed || problem) return
    setWorking(true)
    try {
      let sealedValue: string | undefined
      if (needSecrets) {
        if (!definition) throw new Error('This Connection cannot be read.')
        const refused = secretsProblem(definition, enteredSecrets)
        if (refused) throw new Error(refused)
        sealedValue = await sealCustomConnectionValue(
          definition,
          enteredSecrets,
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
      setFieldSecrets({})
      toast.success('Connection updated')
      dialogRef.current?.closeModal()
    } catch (error) {
      // The form stays as it was, typed secrets included, so the save can be retried.
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
        {moved && !pristine && (
          <div role="status">
            <Alert variant="info" icon size="sm">
              <span className="flex flex-wrap items-center justify-between gap-2 text-xs">
                This Connection changed since you opened the dialog. Your edits are kept.
                <Button type="button" variant="ghost" onClick={seed}>
                  Reload
                </Button>
              </span>
            </Alert>
          </div>
        )}
        {editable ? (
          <CustomConnectionFields
            idPrefix={id}
            editor={editor}
            askSecrets
            secretsStored={!needSecrets}
            secretReason={rebound ? editor.requirement.reason : undefined}
            secretHint={secretHint}
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
                This definition uses a shape this form cannot edit, so only the name and the secret
                can change here.
              </span>
            </Alert>
            {current && (
              <section aria-label="Secret" className="space-y-3">
                {secretHint && (
                  <Alert variant="info" icon size="sm">
                    <span className="text-xs">{secretHint}</span>
                  </Alert>
                )}
                <SecretFieldInputs
                  idPrefix={id}
                  definition={current}
                  secrets={fieldSecrets}
                  setSecrets={setFieldSecrets}
                  stored={!needSecrets}
                />
              </section>
            )}
          </>
        )}
        <Failure message={failure} />
        <div className="flex justify-end">
          <Button
            type="submit"
            icon={FaCheck}
            isLoading={working}
            disabled={!!problem || !changed}
            title={problem || (changed ? undefined : 'Nothing has changed.')}
          >
            Save Connection
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
}
