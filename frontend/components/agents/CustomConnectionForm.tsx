'use client'

import { useCallback, useMemo, useState } from 'react'
import { FaChevronDown, FaChevronRight, FaPlus, FaTrashAlt } from 'react-icons/fa'
import { Alert } from '@/components/common/Alert'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { AgentSelect } from '@/components/agents/AgentSelect'
import {
  HTTP_LIMITS,
  describeHttpInjection,
  httpRequestPreview,
  secretValueProblem,
  type HttpDefinition,
} from '@/utils/agents/httpDefinition'
import {
  HTTP_PRESETS,
  buildCustomConnectionDefinition,
  emptyCustomConnectionForm,
  newHostRow,
  presetCredential,
  secretsByField,
  withPreset,
  type BuiltDefinition,
  type CredentialRow,
  type CustomConnectionForm,
  type HostRow,
} from '@/utils/agents/customConnectionForm'
import { secretRequirement, secretsProblem } from '@/utils/agents/customConnectionSealing'

/**
 * State for one custom Connection being created, edited or reviewed. Secrets live here
 * only until the submit that seals them; `reset` drops them.
 */
export function useCustomConnectionEditor(
  current: HttpDefinition | null,
  initial: () => CustomConnectionForm = emptyCustomConnectionForm
) {
  const [form, setForm] = useState<CustomConnectionForm>(() => initial())
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  // The last definition the form built, so a half-typed host does not hide the secret inputs.
  const [shape, setShape] = useState<HttpDefinition | null>(null)
  const built = useMemo(() => buildCustomConnectionDefinition(form), [form])

  const change = useCallback((next: CustomConnectionForm) => {
    setForm(next)
    const definition = buildCustomConnectionDefinition(next).definition
    if (definition) setShape(definition)
  }, [])

  const reset = useCallback((next: CustomConnectionForm) => {
    setForm(next)
    setSecrets({})
    setShape(buildCustomConnectionDefinition(next).definition)
  }, [])

  const clearSecrets = useCallback(() => setSecrets({}), [])

  const requirement = useMemo(() => {
    if (built.definition || !shape) return secretRequirement(current, built.definition)
    // While the form is incomplete the hosts are those it last built, and the
    // secrets are its rows, so a secret just added or removed already counts.
    return secretRequirement(current, {
      hosts: shape.hosts,
      allowPlainHttp: shape.allowPlainHttp,
      fields: Object.values(built.secretFields).map((name) => ({
        name,
        kind: 'secret' as const,
        source: { type: 'sealed' as const },
      })),
    })
  }, [current, built.definition, built.secretFields, shape])
  const enteredSecrets = useMemo(
    () => secretsByField(built.secretFields, secrets),
    [built.secretFields, secrets]
  )

  return {
    form,
    change,
    reset,
    secrets,
    setSecrets,
    clearSecrets,
    built,
    requirement,
    /** Secrets keyed by field name, ready to seal. */
    enteredSecrets,
    /** Whether any secret has been typed for a field the form still has. */
    secretsTyped: Object.keys(enteredSecrets).length > 0,
  }
}

export type CustomConnectionEditor = ReturnType<typeof useCustomConnectionEditor>

/** Why the editor cannot be submitted yet, or ''. `needSecrets` says whether secrets are due. */
export const editorProblem = (editor: CustomConnectionEditor, needSecrets: boolean): string => {
  const { definition, issues } = editor.built
  if (!definition) return issues.find((issue) => !issue.missing)?.message || 'Fill in the form.'
  return needSecrets ? secretsProblem(definition, editor.enteredSecrets) : ''
}

const FieldIssue = ({ built, at }: { built: BuiltDefinition; at: string }) => {
  const issue = built.issues.find((candidate) => candidate.key === at && !candidate.missing)
  if (!issue) return null
  return (
    <p role="alert" className="mt-1 text-2xs text-red-600 dark:text-red-400">
      {issue.message}
    </p>
  )
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <h4 className="text-2xs font-semibold uppercase tracking-wider text-neutral-500">{children}</h4>
)

/** What an empty input shows for a secret that is stored, as integration credentials do. */
export const STORED_SECRET_MASK = '•'.repeat(40)

/**
 * A write-only input for one secret. It never holds the stored value: an empty input keeps
 * the stored secret.
 */
export function SecretInput({
  id,
  label,
  value,
  setValue,
  definition,
  stored = false,
}: {
  id: string
  label: string
  value: string
  setValue: (value: string) => void
  definition: HttpDefinition | null
  stored?: boolean
}) {
  const problem = value && definition ? secretValueProblem(value, definition) : ''
  return (
    <div className="w-full">
      <Input
        id={id}
        label={label}
        value={value}
        setValue={setValue}
        secret
        required={!stored}
        placeholder={stored ? STORED_SECRET_MASK : undefined}
        autoComplete="off"
        spellCheck={false}
        maxLength={HTTP_LIMITS.secretMaxBytes}
      />
      {problem && (
        <p role="alert" className="mt-1 text-2xs text-red-600 dark:text-red-400">
          {problem}
        </p>
      )}
    </div>
  )
}

/**
 * One write-only input per secret field, keyed by field name. Used where the definition is
 * not being edited.
 */
export function SecretFieldInputs({
  idPrefix,
  definition,
  secrets,
  setSecrets,
  stored = false,
}: {
  idPrefix: string
  definition: HttpDefinition
  secrets: Record<string, string>
  setSecrets: (secrets: Record<string, string>) => void
  stored?: boolean
}) {
  const fields = definition.fields.filter((field) => field.kind === 'secret')
  return (
    <div className="space-y-3">
      {fields.map((field) => {
        const injection = definition.injections.find((candidate) => candidate.field === field.name)
        return (
          <SecretInput
            key={field.name}
            id={`${idPrefix}-secret-${field.name}`}
            label={
              injection
                ? `${field.name} · ${describeHttpInjection(injection, definition)}`
                : field.name
            }
            value={secrets[field.name] || ''}
            setValue={(value) => setSecrets({ ...secrets, [field.name]: value })}
            definition={definition}
            stored={stored}
          />
        )
      })}
    </div>
  )
}

/**
 * The custom Connection form. On an edit, an empty secret input keeps the stored value.
 */
export function CustomConnectionFields({
  idPrefix,
  editor,
  askSecrets,
  secretsStored = false,
  secretReason,
  secretHint,
  showName = true,
  lockHosts = false,
  secretLabels,
}: {
  idPrefix: string
  editor: CustomConnectionEditor
  askSecrets: boolean
  secretsStored?: boolean
  secretReason?: string
  secretHint?: string
  showName?: boolean
  /** The hosts are fixed, as a provider preset sets them: shown, not editable. */
  lockHosts?: boolean
  /** The label of each secret input, by secret field name. */
  secretLabels?: Record<string, string>
}) {
  const { form, change, built, secrets, setSecrets } = editor
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const definition = built.definition

  const setHost = (row: HostRow, patch: Partial<HostRow>) =>
    change({
      ...form,
      hosts: form.hosts.map((candidate) =>
        candidate.id === row.id ? { ...candidate, ...patch } : candidate
      ),
    })
  const setCredential = (row: CredentialRow, patch: Partial<CredentialRow>) =>
    change({
      ...form,
      credentials: form.credentials.map((candidate) =>
        candidate.id === row.id ? { ...candidate, ...patch } : candidate
      ),
    })
  const setSecret = (row: CredentialRow, value: string) =>
    setSecrets({ ...secrets, [row.id]: value })
  const removeCredential = (row: CredentialRow) => {
    const { [row.id]: _dropped, ...rest } = secrets
    setSecrets(rest)
    change({
      ...form,
      credentials: form.credentials.filter((candidate) => candidate.id !== row.id),
    })
  }

  const labelFor = (row: CredentialRow, fallback: string) => secretLabels?.[row.field] ?? fallback
  const rows = form.preset === 'headers' ? form.credentials : form.credentials.slice(0, 1)
  const [first] = rows
  const preset = HTTP_PRESETS.find((candidate) => candidate.value === form.preset)
  const environmentLabel = (row: CredentialRow) =>
    form.preset === 'basic'
      ? 'Environment variable name for the password (optional)'
      : form.preset === 'headers' && row.headerName.trim()
        ? `Environment variable name for ${row.headerName.trim()} (optional)`
        : 'Environment variable name (optional)'
  const environmentInput = (row: CredentialRow) => (
    <div key={row.id} className="w-full">
      <Input
        id={`${idPrefix}-env-${row.id}`}
        label={environmentLabel(row)}
        value={row.env}
        setValue={(value) => setCredential(row, { env: value.toUpperCase() })}
        placeholder="EXAMPLE_API_KEY"
        maxLength={HTTP_LIMITS.environmentName}
        autoComplete="off"
        spellCheck={false}
      />
      <FieldIssue built={built} at={`cred:${row.id}:env`} />
    </div>
  )

  return (
    <div className="space-y-5">
      {showName && (
        <div>
          <Input
            id={`${idPrefix}-name`}
            label="Connection name"
            value={form.name}
            setValue={(value) => change({ ...form, name: value })}
            maxLength={HTTP_LIMITS.connectionName}
            required
          />
          <FieldIssue built={built} at="name" />
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor={`${idPrefix}-preset`} className="block text-xs text-neutral-500">
          Secret type
        </label>
        <AgentSelect
          id={`${idPrefix}-preset`}
          value={form.preset}
          onChange={(value) => {
            const next = HTTP_PRESETS.find((candidate) => candidate.value === value)
            if (next) change(withPreset(form, next.value))
          }}
          options={HTTP_PRESETS.map((candidate) => ({
            value: candidate.value,
            label: candidate.label,
          }))}
        />
        {preset && <p className="text-xs text-neutral-500">{preset.description}</p>}
      </div>

      <section className="space-y-2" aria-label="Allowed hosts">
        <SectionLabel>Allowed hosts</SectionLabel>
        <p className="text-xs text-neutral-500">
          {lockHosts ? (
            'The secret is only ever sent to these hosts. They are fixed by the provider.'
          ) : (
            <>
              The secret is only ever sent to these hosts. Start a host with <code>*.</code> to
              match a domain and its subdomains.
            </>
          )}
        </p>
        {form.hosts.map((row, index) => (
          <div key={row.id} className="flex items-start gap-2">
            <div className="min-w-0 flex-[3]">
              <Input
                id={`${idPrefix}-host-${row.id}`}
                aria-label={`Host ${index + 1}`}
                value={row.host}
                setValue={(value) => setHost(row, { host: value })}
                placeholder="api.example.com"
                readOnly={lockHosts}
                maxLength={HTTP_LIMITS.hostName + 2}
                autoComplete="off"
                spellCheck={false}
                required={index === 0}
              />
              <FieldIssue built={built} at={`host:${row.id}:host`} />
            </div>
            <div className="w-24 shrink-0">
              <Input
                id={`${idPrefix}-port-${row.id}`}
                aria-label={`Port for host ${index + 1} (optional)`}
                value={row.port}
                setValue={(value) => setHost(row, { port: value.replace(/[^0-9]/g, '') })}
                placeholder="Port"
                readOnly={lockHosts}
                inputMode="numeric"
                maxLength={5}
                autoComplete="off"
              />
              <FieldIssue built={built} at={`host:${row.id}:port`} />
            </div>
            <div className="min-w-0 flex-[2]">
              <Input
                id={`${idPrefix}-path-${row.id}`}
                aria-label={`Path for host ${index + 1} (optional)`}
                value={row.path}
                setValue={(value) => setHost(row, { path: value })}
                placeholder="/v1/*"
                readOnly={lockHosts}
                maxLength={HTTP_LIMITS.path}
                autoComplete="off"
                spellCheck={false}
              />
              <FieldIssue built={built} at={`host:${row.id}:path`} />
            </div>
            {form.hosts.length > 1 && !lockHosts && (
              <Button
                type="button"
                variant="ghost"
                icon={FaTrashAlt}
                title={`Remove host ${index + 1}`}
                aria-label={`Remove host ${index + 1}`}
                onClick={() =>
                  change({
                    ...form,
                    hosts: form.hosts.filter((candidate) => candidate.id !== row.id),
                  })
                }
              />
            )}
          </div>
        ))}
        <FieldIssue built={built} at="hosts" />
        {form.hosts.length < HTTP_LIMITS.hosts && !lockHosts && (
          <Button
            type="button"
            variant="secondary"
            icon={FaPlus}
            onClick={() => change({ ...form, hosts: [...form.hosts, newHostRow()] })}
          >
            Add host
          </Button>
        )}
      </section>

      {/* A token has nothing else to set here, so without its input the section is empty. */}
      {(askSecrets || form.preset !== 'bearer') && (
        <section className="space-y-3" aria-label="Secret">
          <SectionLabel>{form.preset === 'headers' ? 'Headers' : 'Secret'}</SectionLabel>
          {askSecrets && secretReason && (
            <Alert variant="warning" icon size="sm">
              <span className="text-xs">{secretReason}</span>
            </Alert>
          )}
          {askSecrets && secretHint && (
            <Alert variant="info" icon size="sm">
              <span className="text-xs">{secretHint}</span>
            </Alert>
          )}

          {form.preset === 'bearer' && first && (
            <SecretInput
              id={`${idPrefix}-secret-${first.id}`}
              label={labelFor(first, 'Token')}
              value={secrets[first.id] || ''}
              setValue={(value) => setSecret(first, value)}
              definition={definition}
              stored={secretsStored}
            />
          )}

          {form.preset === 'basic' && first && (
            <>
              <div>
                <Input
                  id={`${idPrefix}-username-${first.id}`}
                  label="Username"
                  value={first.username}
                  setValue={(value) => setCredential(first, { username: value })}
                  maxLength={HTTP_LIMITS.identifierValue}
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <FieldIssue built={built} at={`cred:${first.id}:username`} />
                <p className="mt-1 text-xs text-neutral-500">
                  The username is not a secret: the Agent can read it.
                </p>
              </div>
              {askSecrets && (
                <SecretInput
                  id={`${idPrefix}-secret-${first.id}`}
                  label={labelFor(first, 'Password')}
                  value={secrets[first.id] || ''}
                  setValue={(value) => setSecret(first, value)}
                  definition={definition}
                  stored={secretsStored}
                />
              )}
            </>
          )}

          {form.preset === 'query' && first && (
            <>
              <div>
                <Input
                  id={`${idPrefix}-query-${first.id}`}
                  label="Parameter name"
                  value={first.queryName}
                  setValue={(value) => setCredential(first, { queryName: value })}
                  placeholder="api_key"
                  maxLength={HTTP_LIMITS.injectionName}
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <FieldIssue built={built} at={`cred:${first.id}:queryName`} />
              </div>
              {askSecrets && (
                <SecretInput
                  id={`${idPrefix}-secret-${first.id}`}
                  label={labelFor(first, 'Value')}
                  value={secrets[first.id] || ''}
                  setValue={(value) => setSecret(first, value)}
                  definition={definition}
                  stored={secretsStored}
                />
              )}
            </>
          )}

          {form.preset === 'headers' && (
            <>
              {rows.map((row, index) => (
                <div
                  key={row.id}
                  className="space-y-2 rounded-lg border border-neutral-500/20 bg-neutral-500/5 p-3"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-[3]">
                      <Input
                        id={`${idPrefix}-header-${row.id}`}
                        label="Header name"
                        value={row.headerName}
                        setValue={(value) => setCredential(row, { headerName: value })}
                        placeholder="X-Api-Key"
                        maxLength={HTTP_LIMITS.injectionName}
                        autoComplete="off"
                        spellCheck={false}
                        required
                      />
                      <FieldIssue built={built} at={`cred:${row.id}:headerName`} />
                    </div>
                    <div className="min-w-0 flex-[2]">
                      <Input
                        id={`${idPrefix}-prefix-${row.id}`}
                        label="Prefix (optional)"
                        value={row.prefix}
                        setValue={(value) => setCredential(row, { prefix: value })}
                        placeholder="Bearer "
                        maxLength={HTTP_LIMITS.headerPrefix}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <FieldIssue built={built} at={`cred:${row.id}:prefix`} />
                    </div>
                    {rows.length > 1 && (
                      <div className="pt-6">
                        <Button
                          type="button"
                          variant="ghost"
                          icon={FaTrashAlt}
                          title={`Remove header ${index + 1}`}
                          aria-label={`Remove header ${index + 1}`}
                          onClick={() => removeCredential(row)}
                        />
                      </div>
                    )}
                  </div>
                  {askSecrets && (
                    <SecretInput
                      id={`${idPrefix}-secret-${row.id}`}
                      label={labelFor(row, 'Secret value')}
                      value={secrets[row.id] || ''}
                      setValue={(value) => setSecret(row, value)}
                      definition={definition}
                      stored={secretsStored}
                    />
                  )}
                </div>
              ))}
              <FieldIssue built={built} at="credentials" />
              {rows.length < HTTP_LIMITS.injections && (
                <Button
                  type="button"
                  variant="secondary"
                  icon={FaPlus}
                  onClick={() =>
                    change({
                      ...form,
                      credentials: [...form.credentials, presetCredential('headers')],
                    })
                  }
                >
                  Add header
                </Button>
              )}
            </>
          )}
        </section>
      )}

      <section className="space-y-3" aria-label="Advanced">
        <Button
          type="button"
          variant="ghost"
          icon={advancedOpen ? FaChevronDown : FaChevronRight}
          aria-expanded={advancedOpen}
          aria-controls={`${idPrefix}-advanced`}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          Advanced
        </Button>
        {advancedOpen && (
          <div id={`${idPrefix}-advanced`} className="space-y-4">
            {rows.map((row) => environmentInput(row))}
            <p className="-mt-2 text-xs text-neutral-500">
              The variable your SDK or CLI reads its key from. It is set to a placeholder for the
              Agent, never the real secret.
            </p>
            {rows.map((row) => (
              <div key={row.id}>
                <Input
                  id={`${idPrefix}-decoy-${row.id}`}
                  label={
                    form.preset === 'headers' && row.headerName.trim()
                      ? `Placeholder prefix for ${row.headerName.trim()} (optional)`
                      : 'Placeholder prefix (optional)'
                  }
                  value={row.decoyPrefix}
                  setValue={(value) => setCredential(row, { decoyPrefix: value })}
                  placeholder="sk-"
                  maxLength={HTTP_LIMITS.decoyPrefix}
                  autoComplete="off"
                  spellCheck={false}
                />
                <FieldIssue built={built} at={`cred:${row.id}:decoyPrefix`} />
              </div>
            ))}
            <p className="-mt-2 text-xs text-neutral-500">
              The Agent only ever holds a placeholder. A prefix makes the placeholder look like the
              real thing to tools that check its shape.
            </p>
            {form.preset === 'basic' && first && (
              <div>
                <Input
                  id={`${idPrefix}-username-env-${first.id}`}
                  label="Environment variable name for the username (optional)"
                  value={first.usernameEnv}
                  setValue={(value) => setCredential(first, { usernameEnv: value.toUpperCase() })}
                  placeholder="EXAMPLE_USERNAME"
                  maxLength={HTTP_LIMITS.environmentName}
                  autoComplete="off"
                  spellCheck={false}
                />
                <FieldIssue built={built} at={`cred:${first.id}:usernameEnv`} />
              </div>
            )}
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium">Block a request that carries no credential</p>
                <p className="text-xs text-neutral-500">
                  By default the proxy attaches the secret to a request that has none. Turn this on
                  to require the placeholder on every request.
                </p>
              </div>
              <ToggleSwitch
                value={form.blockWhenAbsent}
                onToggle={() => change({ ...form, blockWhenAbsent: !form.blockWhenAbsent })}
                label="Block a request that carries no credential"
                size="sm"
              />
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium">Allow plain HTTP</p>
                <p className="text-xs text-neutral-500">
                  Off by default: the secret is only sent over HTTPS.
                </p>
              </div>
              <ToggleSwitch
                value={form.allowPlainHttp}
                onToggle={() => change({ ...form, allowPlainHttp: !form.allowPlainHttp })}
                label="Allow plain HTTP"
                size="sm"
              />
            </div>
            {form.allowPlainHttp && (
              <Alert variant="warning" icon size="sm">
                <span className="text-xs">
                  Over plain HTTP anyone on the network path can read the secret. Only allow it for
                  a service you reach on a trusted private network.
                </span>
              </Alert>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2" aria-label="Preview">
        <SectionLabel>What a request looks like</SectionLabel>
        {definition ? (
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-neutral-500/20 bg-neutral-500/5 p-3 font-mono text-xs">
            {httpRequestPreview(definition)}
          </pre>
        ) : (
          <p className="text-xs text-neutral-500">
            Fill in a host and where the secret goes to see a preview.
          </p>
        )}
        <p className="text-xs text-neutral-500">
          The Agent sends the placeholder, or nothing; the Phase proxy puts the real secret in its
          place on the way out.
        </p>
      </section>
    </div>
  )
}
