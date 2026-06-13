'use client'

import {
  EnvironmentType,
  KeyMapInput,
  ProviderCredentialsType,
  RotationProviderType,
} from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { Card } from '@/components/common/Card'
import { EnableSSEDialog } from '@/components/apps/EnableSSEDialog'
import GenericDialog from '@/components/common/GenericDialog'
import { Input } from '@/components/common/Input'
import { Textarea } from '@/components/common/TextArea'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import { Listbox, Tab } from '@headlessui/react'
import { FaChevronDown } from 'react-icons/fa'
import { ProviderCredentialPicker } from '@/components/syncing/ProviderCredentialPicker'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import { Step, Stepper } from '@/components/onboarding/Stepper'
import { organisationContext } from '@/contexts/organisationContext'
import { CreateRotatingSecretOP } from '@/graphql/mutations/environments/secrets/rotation/createRotatingSecret.gql'
import { GetRotationProviders } from '@/graphql/queries/secrets/rotation/getRotationProviders.gql'
import { GetRotatingSecrets } from '@/graphql/queries/secrets/rotation/getRotatingSecrets.gql'
import { ImportRotationTemplate } from '@/graphql/queries/secrets/rotation/importRotationTemplate.gql'
import { GetOpenAIProjects } from '@/graphql/queries/secrets/rotation/getOpenAIProjects.gql'
import { GetSecrets } from '@/graphql/queries/secrets/getSecrets.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import { encryptAsymmetric } from '@/utils/crypto'
import { humanReadableDurationLong } from '@/utils/time'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { toUpper } from 'lodash'
import clsx from 'clsx'
import {
  forwardRef,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { FaCogs } from 'react-icons/fa'
import { FaArrowRightLong, FaFileImport } from 'react-icons/fa6'
import { MdOutlinePassword, MdSchedule } from 'react-icons/md'
import { toast } from 'react-toastify'

type CreateRotatingSecretDialogRef = {
  openModal: () => void
  closeModal: () => void
}

export interface CreateRotatingSecretInitialState {
  providerId: string
  authenticationId?: string | null
  config?: Record<string, unknown> | null
  keyMap?: Array<{ id: string; keyName: string }> | null
  name?: string | null
  description?: string | null
  rotationIntervalSeconds?: number | null
  revocationDelaySeconds?: number | null
}

interface CreateRotatingSecretDialogProps {
  environment: EnvironmentType
  path: string
  /** Optional prefill — seeded on dialog open. User can edit every field. */
  initialState?: CreateRotatingSecretInitialState | null
  /** Fired after a successful create + dialog close. */
  onCreated?: () => void
}

interface SchemaField {
  id: string
  label: string
  required?: boolean
  field_type?: string
  default?: unknown
  help_text?: string
  help_url?: string
  masked?: boolean
}

const INTERVAL_PRESETS = [
  { label: '1 hour', seconds: 3600 },
  { label: '24 hours', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
  { label: '30 days', seconds: 2592000 },
  { label: '60 days', seconds: 5184000 },
  { label: '120 days', seconds: 10368000 },
]

const REVOCATION_DELAY_PRESETS = [
  { label: 'Instant', seconds: 0 },
  { label: '5 minutes', seconds: 300 },
  { label: '1 hour', seconds: 3600 },
  { label: '1 day', seconds: 86400 },
  { label: '15 days', seconds: 1296000 },
  { label: '30 days', seconds: 2592000 },
]

// Key-name prefix per provider. Used to prefill the output → secret-key
// mapping form so users don't have to type the same prefix every time.
const KEY_NAME_PREFIX: Record<string, string> = {
  openai: 'OPEN_AI',
  litellm: 'LITE_LLM',
}

const slugifyForProviderName = (input: string): string =>
  input
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()

const buildDefaultNameTemplate = (env: EnvironmentType, path: string): string => {
  const parts = ['phase']
  const app = slugifyForProviderName(env.app?.name ?? '')
  if (app) parts.push(app)
  const envSlug = slugifyForProviderName(env.name ?? '')
  if (envSlug) parts.push(envSlug)
  if (path && path !== '/') {
    const pathSlug = slugifyForProviderName(path)
    if (pathSlug) parts.push(pathSlug)
  }
  parts.push('{id}')
  return parts.join('-')
}

export const CreateRotatingSecretDialog = forwardRef<
  CreateRotatingSecretDialogRef,
  CreateRotatingSecretDialogProps
>(({ environment, path, initialState, onCreated }, ref) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { data: providersData } = useQuery(GetRotationProviders)
  const { data: savedCredentialsData } = useQuery(GetSavedCredentials, {
    variables: { orgId: organisation?.id },
    skip: !organisation,
  })
  const [createRotatingSecret, { loading: creating }] = useMutation(CreateRotatingSecretOP)

  const dialogRef = useRef<{ openModal: () => void; closeModal: () => void }>(null)
  useImperativeHandle(ref, () => ({
    openModal: () => dialogRef.current?.openModal(),
    closeModal: () => dialogRef.current?.closeModal(),
  }))

  const [provider, setProvider] = useState<RotationProviderType | null>(null)
  const [step, setStep] = useState(0)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [credential, setCredential] = useState<ProviderCredentialsType | null>(null)
  const [config, setConfig] = useState<Record<string, unknown>>({})
  const [keyMap, setKeyMap] = useState<KeyMapInput[]>([])
  const [intervalSeconds, setIntervalSeconds] = useState(3600)
  const [revocationDelaySeconds, setRevocationDelaySeconds] = useState(60)
  const [templateRef, setTemplateRef] = useState('')
  const [importedJson, setImportedJson] = useState<string | null>(null)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [configTab, setConfigTab] = useState(0) // 0 = Import, 1 = Manual
  const [importTemplate, { loading: importing }] = useLazyQuery(ImportRotationTemplate)
  const [fetchOpenAIProjects, { data: openaiProjectsData, loading: loadingProjects, error: projectsError }] =
    useLazyQuery(GetOpenAIProjects, { fetchPolicy: 'network-only' })

  type OpenAIProject = { id: string; name: string; status?: string | null }
  const openaiProjects: OpenAIProject[] =
    (openaiProjectsData?.openaiProjects as OpenAIProject[] | undefined) ?? []
  useEffect(() => {
    if (provider?.id !== 'openai') return
    if (!credential) return
    fetchOpenAIProjects({ variables: { authenticationId: credential.id } })
  }, [provider?.id, credential, fetchOpenAIProjects])

  const handleImportedJsonChange = (text: string) => {
    setImportedJson(text)
    if (!text.trim()) {
      setJsonError('JSON cannot be empty')
      return
    }
    try {
      const parsed = JSON.parse(text)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setJsonError('Top-level value must be a JSON object')
        return
      }
      setConfig(parsed as Record<string, unknown>)
      setJsonError(null)
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON')
    }
  }

  const reset = () => {
    setProvider(null)
    setStep(0)
    setName('')
    setDescription('')
    setCredential(null)
    setConfig({})
    setKeyMap([])
    setIntervalSeconds(3600)
    setRevocationDelaySeconds(60)
    setTemplateRef('')
    setImportedJson(null)
    setJsonError(null)
    setConfigTab(0)
    prefillAppliedRef.current = false
  }

  const handleImportTemplate = async () => {
    if (!provider || !credential) {
      toast.error('Select a provider and root credentials first')
      return
    }
    if (!templateRef.trim()) {
      toast.error('Enter a template key id or value')
      return
    }
    try {
      const { data, error } = await importTemplate({
        variables: {
          providerId: provider.id,
          authenticationId: credential.id,
          templateRef: templateRef.trim(),
        },
        fetchPolicy: 'cache-first',
      })
      if (error) throw error
      const imported = (data?.rotationProviderImportTemplate ?? {}) as Record<string, unknown>
      if (!Object.keys(imported).length) {
        toast.warn('Template found but no importable fields were returned')
        setImportedJson(null)
        return
      }
      setConfig(imported)
      setImportedJson(JSON.stringify(imported, null, 2))
      setJsonError(null)
      toast.success(
        `Imported ${Object.keys(imported).length} field${
          Object.keys(imported).length === 1 ? '' : 's'
        } from template`
      )
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to import template'
      toast.error(message)
    }
  }

  const handleCredentialChange = useCallback(
    (cred: ProviderCredentialsType) => setCredential(cred),
    []
  )

  // Tracks whether we've already applied the prefill on this dialog open.
  // Prevents the cred picker / providers data resolving later from re-seeding.
  const prefillAppliedRef = useRef(false)

  useEffect(() => {
    if (!provider) return
    const outputs = (provider.outputSchema as SchemaField[]) ?? []
    const prefix = KEY_NAME_PREFIX[provider.id]
    const seededKeyMap: KeyMapInput[] = outputs.map((f) => {
      const fromPrefill = initialState?.keyMap?.find((k) => k.id === f.id)
      return {
        id: f.id,
        keyName:
          fromPrefill?.keyName ??
          (prefix ? `${prefix}_${f.id.toUpperCase()}` : ''),
      }
    })
    setKeyMap(seededKeyMap)
    const configs = (provider.configSchema as SchemaField[]) ?? []
    const initialConfig: Record<string, unknown> = {}
    configs.forEach((f) => {
      if (f.default !== undefined && f.default !== null) initialConfig[f.id] = f.default
    })
    // Seed a context-aware name template so the provider-side resource
    // name reflects the app/env/path it belongs to.
    if (configs.some((f) => f.id === 'name_template')) {
      initialConfig.name_template = buildDefaultNameTemplate(environment, path)
    }
    if (initialState?.config) {
      // Prefill overrides defaults — and the target env's name_template should
      // reflect the target, not the source, so don't carry that over.
      const { name_template: _ignored, ...rest } = initialState.config as Record<
        string,
        unknown
      >
      void _ignored
      Object.assign(initialConfig, rest)
    }
    setConfig(initialConfig)
    setName(initialState?.name ?? `${provider.name} API key`)
    if (initialState?.description) setDescription(initialState.description)
    if (initialState?.rotationIntervalSeconds)
      setIntervalSeconds(initialState.rotationIntervalSeconds)
    if (initialState?.revocationDelaySeconds !== undefined && initialState?.revocationDelaySeconds !== null)
      setRevocationDelaySeconds(initialState.revocationDelaySeconds)
  }, [provider, environment, path, initialState])

  // Auto-select the provider when prefill arrives + providersData is ready.
  useEffect(() => {
    if (!initialState || prefillAppliedRef.current || !providersData) return
    const target = (providersData.rotationProviders as RotationProviderType[] | undefined)?.find(
      (p) => p.id === initialState.providerId
    )
    if (target) {
      setProvider(target)
      prefillAppliedRef.current = true
    }
  }, [initialState, providersData])

  // Auto-select the credential once GetSavedCredentials resolves.
  useEffect(() => {
    if (!initialState?.authenticationId) return
    if (credential) return
    const list = (savedCredentialsData?.savedCredentials as ProviderCredentialsType[] | undefined) ?? []
    const match = list.find((c) => c.id === initialState.authenticationId)
    if (match) setCredential(match)
  }, [initialState?.authenticationId, savedCredentialsData, credential])

  const steps: Step[] = useMemo(
    () => [
      {
        index: 0,
        name: 'Provider',
        icon: <FaCogs />,
        title: 'Provider & root credentials',
        description: 'Select provider and the root credentials to mint with',
      },
      {
        index: 1,
        name: 'Config',
        icon: <MdOutlinePassword />,
        title: 'Provider config',
        description: 'Provider-specific options for minted credentials',
      },
      {
        index: 2,
        name: 'Schedule',
        icon: <MdSchedule />,
        title: 'Schedule & outputs',
        description: 'Rotation cadence, revocation delay, and secret keys',
      },
    ],
    []
  )

  const next = () => setStep((s) => Math.min(s + 1, steps.length - 1))
  const prev = () => {
    // Back from step 0 returns to the provider picker; otherwise step--.
    if (step === 0) {
      setProvider(null)
      return
    }
    setStep((s) => Math.max(s - 1, 0))
  }

  const LIST_FIELDS = new Set(['models', 'tags'])
  const NUMERIC_FIELDS = new Set([
    'max_budget',
    'soft_budget',
    'tpm_limit',
    'rpm_limit',
    'max_parallel_requests',
  ])

  // Coerce list/numeric strings to their typed form. Run once at submit so
  // intermediate keystrokes ("5." while typing 5.5, "gpt-4," while typing
  // a comma-separated list) survive without being eaten by a round-trip
  // through the coerced state.
  const coerceConfigForSubmit = (input: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(input)) {
      if (typeof raw !== 'string') {
        out[key] = raw
        continue
      }
      const trimmed = raw.trim()
      if (LIST_FIELDS.has(key)) {
        out[key] = trimmed ? trimmed.split(',').map((s) => s.trim()).filter(Boolean) : []
        continue
      }
      if (NUMERIC_FIELDS.has(key)) {
        if (trimmed === '') continue
        const n = Number(trimmed)
        out[key] = Number.isFinite(n) ? n : raw
        continue
      }
      out[key] = raw
    }
    return out
  }

  const updateConfig = (key: string, value: unknown) => {
    setConfig((prev) => {
      const next = { ...prev, [key]: value }
      if (value === undefined) delete next[key]
      return next
    })
  }

  const renderConfigField = (field: SchemaField) => {
    const helpLink = field.help_url ? (
      <a
        href={field.help_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-2xs text-emerald-600 dark:text-emerald-400 hover:underline"
      >
        Learn more ↗
      </a>
    ) : null

    if (provider?.id === 'openai' && field.id === 'project_id') {
      const selected = openaiProjects.find((p) => p.id === config[field.id])
      const hasProjects = openaiProjects.length > 0
      return (
        <div key={field.id} className="space-y-1">
          <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            {field.label}
            {field.required && <span className="text-red-500">*</span>}
            {helpLink}
          </div>
          {field.help_text && (
            <div className="text-2xs text-neutral-500">{field.help_text}</div>
          )}
          {!credential ? (
            <div className="text-2xs text-neutral-500">
              Pick root credentials in the previous step to load projects.
            </div>
          ) : projectsError ? (
            <div className="space-y-1">
              <div className="text-2xs text-red-500">
                Couldn&apos;t load projects: {projectsError.message}
              </div>
              <Input
                className="font-mono ph-no-capture"
                placeholder="proj_..."
                value={(config[field.id] as string) ?? ''}
                setValue={(v) => updateConfig(field.id, v)}
              />
            </div>
          ) : (
            <Listbox
              value={(config[field.id] as string) ?? ''}
              onChange={(value) => updateConfig(field.id, value)}
            >
              {({ open }) => (
                <div className="relative">
                  <Listbox.Button
                    as="div"
                    className={clsx(
                      'px-2 py-1.5 flex items-center justify-between bg-zinc-100 dark:bg-zinc-800/60 text-zinc-800 dark:text-white text-sm border border-neutral-500/20 cursor-pointer',
                      open ? 'rounded-t-md' : 'rounded-md'
                    )}
                  >
                    <span className="truncate">
                      {loadingProjects
                        ? 'Loading projects…'
                        : selected
                          ? `${selected.name} (${selected.id})`
                          : hasProjects
                            ? 'Select a project'
                            : 'No active projects found'}
                    </span>
                    <FaChevronDown
                      className={clsx(
                        'transition-transform ease duration-300 text-neutral-500 text-xs',
                        open ? 'rotate-180' : 'rotate-0'
                      )}
                    />
                  </Listbox.Button>
                  {hasProjects && (
                    <Listbox.Options className="bg-zinc-100 w-full dark:bg-zinc-800/60 p-1.5 rounded-b-md shadow-2xl backdrop-blur-md absolute z-10 space-y-1 border border-t-0 border-neutral-500/20 max-h-60 overflow-auto">
                      {openaiProjects.map((p) => (
                        <Listbox.Option key={p.id} value={p.id} as={Fragment}>
                          {({ active }) => (
                            <div
                              className={clsx(
                                'flex items-center justify-between gap-2 px-2 py-1.5 cursor-pointer rounded-md text-sm text-black dark:text-white',
                                active && 'bg-zinc-200 dark:bg-zinc-700'
                              )}
                            >
                              <span className="font-medium truncate">{p.name}</span>
                              <span className="font-mono text-2xs text-neutral-500 truncate">
                                {p.id}
                              </span>
                            </div>
                          )}
                        </Listbox.Option>
                      ))}
                    </Listbox.Options>
                  )}
                </div>
              )}
            </Listbox>
          )}
        </div>
      )
    }

    if (field.field_type === 'bool') {
      return (
        <div key={field.id} className="flex items-center justify-between gap-3 py-1">
          <div>
            <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              {field.label}
              {helpLink}
            </div>
            {field.help_text && (
              <div className="text-2xs text-neutral-500">{field.help_text}</div>
            )}
          </div>
          <ToggleSwitch
            value={Boolean(config[field.id])}
            onToggle={() => updateConfig(field.id, !config[field.id])}
          />
        </div>
      )
    }
    return (
      <div key={field.id} className="space-y-1">
        <Textarea
          label={field.label}
          placeholder={field.help_text}
          required={field.required}
          value={
            Array.isArray(config[field.id])
              ? (config[field.id] as unknown[]).join(', ')
              : ((config[field.id] as string | number | undefined) ?? '').toString()
          }
          setValue={(val) => updateConfig(field.id, val)}
        />
        {helpLink && <div className="flex justify-end">{helpLink}</div>}
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (jsonError) {
      toast.error(`Fix the imported config JSON before continuing: ${jsonError}`)
      return
    }
    // Block leaving the Config step until every required schema field is set.
    if (step === 1) {
      const configFields = (provider?.configSchema as SchemaField[] | undefined) ?? []
      const missing = configFields.find((f) => {
        if (!f.required) return false
        const v = config[f.id]
        return v === undefined || v === null || v === ''
      })
      if (missing) {
        toast.error(`${missing.label} is required`)
        return
      }
      // The name template must include {id} so each mint produces a
      // unique provider-side resource name (otherwise rotations would
      // collide on the provider).
      if (configFields.some((f) => f.id === 'name_template')) {
        const template = (config.name_template as string | undefined) ?? ''
        if (!template.includes('{id}')) {
          toast.error('Name template must include {id}')
          return
        }
      }
    }
    if (step < steps.length - 1) {
      next()
      return
    }

    if (!provider) return
    if (!credential) {
      toast.error('Please select authentication credentials')
      return
    }
    if (revocationDelaySeconds >= intervalSeconds) {
      toast.error('Revocation delay must be less than the rotation interval')
      return
    }
    if (intervalSeconds < 60) {
      toast.error('Rotation interval must be at least 60 seconds')
      return
    }

    const blankKey = keyMap.some((k) => !k.keyName?.trim())
    if (blankKey) {
      toast.error('All output keys must be assigned a secret name')
      return
    }

    const encryptedKeyMap = await Promise.all(
      keyMap.map(async (k) => ({
        ...k,
        keyName: k.keyName
          ? await encryptAsymmetric(k.keyName, environment.identityKey)
          : k.keyName,
      }))
    )

    try {
      await createRotatingSecret({
        variables: {
          organisationId: organisation?.id,
          environmentId: environment.id,
          name,
          description,
          path,
          provider: provider.id,
          authenticationId: credential.id,
          config: coerceConfigForSubmit(config),
          keyMap: encryptedKeyMap,
          rotationIntervalSeconds: intervalSeconds,
          revocationDelaySeconds: revocationDelaySeconds,
        },
        refetchQueries: [
          {
            query: GetSecrets,
            variables: { appId: environment.app.id, envId: environment.id, path },
          },
          {
            query: GetRotatingSecrets,
            variables: { orgId: organisation?.id, envId: environment.id },
          },
        ],
      })
      toast.success('Created rotating secret.')
      reset()
      dialogRef.current?.closeModal()
      onCreated?.()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create rotating secret'
      toast.error(message)
    }
  }

  const ProviderMenu = () => (
    <div className="grid gap-2">
      {(providersData?.rotationProviders as RotationProviderType[] | undefined)?.map((p) => (
        <div className="cursor-pointer" key={p.id} onClick={() => setProvider(p)}>
          <Card>
            <div className="flex items-center gap-3">
              <div className="text-2xl">
                <ProviderIcon providerId={p.id} />
              </div>
              <div>
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {p.name}
                </div>
                <div className="text-neutral-500 text-2xs">
                  Rotate {p.name} credentials on a schedule
                </div>
              </div>
            </div>
          </Card>
        </div>
      ))}
    </div>
  )

  const configFields = (provider?.configSchema as SchemaField[] | undefined) ?? []
  const outputFields = (provider?.outputSchema as SchemaField[] | undefined) ?? []

  return (
    <GenericDialog ref={dialogRef} title="Set up a Rotating Secret" size="lg" onClose={reset}>
      {!environment.app.sseEnabled ? (
        <div className="space-y-4 pt-4">
          <div>
            <div className="text-sm font-semibold text-black dark:text-white">
              Server-side encryption (SSE)
            </div>
            <div className="text-neutral-500 text-2xs">
              Server-side encryption is required to use Rotating Secrets. Click the button below to
              enable SSE.
            </div>
          </div>
          <div className="flex justify-start">
            <EnableSSEDialog appId={environment.app.id} />
          </div>
        </div>
      ) : (
        <div className="space-y-4 pt-1">
          <div className="text-neutral-500 text-sm">
            Set up a Phase managed secret rotation on a schedule inside of your environment.
          </div>

          {!provider && <ProviderMenu />}

          {provider && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Stepper steps={steps} activeStep={step} align="left" />

              {step === 0 && (
                <div className="space-y-4 text-sm">
                  <div>
                    <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                      Root credentials
                    </div>
                    <div className="text-2xs text-neutral-500 mb-2">
                      The {provider.name} credentials Phase will use to create and revoke keys.
                    </div>
                    <ProviderCredentialPicker
                      credential={credential}
                      setCredential={handleCredentialChange}
                      orgId={organisation!.id}
                      providerFilter={provider.id}
                      setDefault
                    />
                  </div>

                  <Input
                    label="Name"
                    required
                    placeholder="e.g. OpenAI prod key"
                    value={name}
                    setValue={setName}
                  />
                  <Input
                    label="Description"
                    placeholder="Optional"
                    value={description}
                    setValue={setDescription}
                  />
                </div>
              )}

              {step === 1 && (
                <div className="space-y-3 text-sm">
                  {provider.id === 'litellm' ? (
                    <Tab.Group selectedIndex={configTab} onChange={setConfigTab}>
                      <Tab.List className="flex gap-2 w-full border-b border-neutral-500/20">
                        {['Import config', 'Manual config'].map((label) => (
                          <Tab as={Fragment} key={label}>
                            {({ selected }) => (
                              <div
                                className={clsx(
                                  'p-2 text-xs font-medium border-b focus:outline-none cursor-pointer text-black dark:text-white',
                                  selected
                                    ? 'border-emerald-500 font-semibold'
                                    : 'border-transparent'
                                )}
                              >
                                {label}
                              </div>
                            )}
                          </Tab>
                        ))}
                      </Tab.List>

                      <Tab.Panels className="pt-3">
                        {/* Import config */}
                        <Tab.Panel className="space-y-3">
                          <div className="text-2xs text-neutral-500">
                            Configure a key in LiteLLM&apos;s UI with the options
                            you want, then paste its id or value here to copy the
                            full config — including object fields like{' '}
                            <code>metadata</code>, <code>aliases</code>, and{' '}
                            <code>permissions</code> that aren&apos;t in the manual
                            form.
                          </div>
                          <div className="flex items-end gap-2">
                            <div className="flex-1">
                              <Input
                                className="font-mono ph-no-capture"
                                placeholder="LiteLLM key id or value"
                                value={templateRef}
                                setValue={setTemplateRef}
                              />
                            </div>
                            <Button
                              variant="secondary"
                              type="button"
                              icon={FaFileImport}
                              isLoading={importing}
                              onClick={handleImportTemplate}
                            >
                              Import
                            </Button>
                          </div>
                          {importedJson !== null && (
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <div className="text-2xs font-medium text-zinc-900 dark:text-zinc-100">
                                  Imported config (will be sent to LiteLLM on each rotation)
                                </div>
                                <div
                                  className={clsx(
                                    'text-2xs',
                                    jsonError ? 'text-red-500' : 'text-emerald-500'
                                  )}
                                >
                                  {jsonError ? 'Invalid JSON' : 'Valid JSON'}
                                </div>
                              </div>
                              <Textarea
                                value={importedJson}
                                setValue={handleImportedJsonChange}
                                rows={14}
                                spellCheck={false}
                                className={clsx(
                                  'text-2xs font-mono ph-no-capture bg-zinc-100 dark:bg-zinc-800 rounded p-2 ring-1 ring-inset',
                                  jsonError
                                    ? 'ring-red-500/60 focus:ring-red-500'
                                    : 'ring-neutral-500/20 focus:ring-zinc-500'
                                )}
                              />
                              {jsonError && (
                                <div className="text-2xs text-red-500 mt-1 font-mono break-all">
                                  {jsonError}
                                </div>
                              )}
                            </div>
                          )}
                        </Tab.Panel>

                        {/* Manual config */}
                        <Tab.Panel className="space-y-3">
                          {configFields.length === 0 && (
                            <div className="text-2xs text-neutral-500">
                              This provider has no additional configuration.
                            </div>
                          )}
                          {configFields.map((field) => renderConfigField(field))}
                        </Tab.Panel>
                      </Tab.Panels>
                    </Tab.Group>
                  ) : (
                    <div className="space-y-3">
                      {configFields.length === 0 && (
                        <div className="text-2xs text-neutral-500">
                          This provider has no additional configuration.
                        </div>
                      )}
                      {configFields.map((field) => renderConfigField(field))}
                    </div>
                  )}
                </div>
              )}

              {step === 2 && (
                <div className="space-y-4 text-sm">
                  <div>
                    <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                      Rotation interval
                    </div>
                    <div className="text-2xs text-neutral-500 mb-2">
                      How often a new credential is minted.
                    </div>
                    <div className="flex items-end gap-3">
                      <div className="flex gap-2 flex-1 min-w-0 flex-wrap">
                        {INTERVAL_PRESETS.map((p) => (
                          <Button
                            key={p.label}
                            type="button"
                            variant={intervalSeconds === p.seconds ? 'secondary' : 'ghost'}
                            onClick={() => setIntervalSeconds(p.seconds)}
                          >
                            {p.label}
                          </Button>
                        ))}
                      </div>
                      <div className="w-28 shrink-0">
                        <Input
                          type="number"
                          min={60}
                          label="Seconds"
                          value={String(intervalSeconds)}
                          setValue={(v) => setIntervalSeconds(parseInt(v || '0', 10))}
                          required
                        />
                      </div>
                    </div>
                    <div className="text-2xs text-neutral-500 mt-1 text-right">
                      Rotate every {humanReadableDurationLong(intervalSeconds) || '—'}
                    </div>
                  </div>

                  <div className="border-t border-neutral-500/20" />

                  <div>
                    <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                      Revocation delay
                    </div>
                    <div className="text-2xs text-neutral-500 mb-2">
                      How long Phase waits before revoking the previous credential after a
                      rotation. Set to 0 to revoke immediately when the new credential is minted.
                    </div>
                    <div className="flex items-end gap-3">
                      <div className="flex gap-2 flex-1 min-w-0 flex-wrap">
                        {REVOCATION_DELAY_PRESETS.map((p) => (
                          <Button
                            key={p.label}
                            type="button"
                            variant={revocationDelaySeconds === p.seconds ? 'secondary' : 'ghost'}
                            onClick={() => setRevocationDelaySeconds(p.seconds)}
                          >
                            {p.label}
                          </Button>
                        ))}
                      </div>
                      <div className="w-28 shrink-0">
                        <Input
                          type="number"
                          min={0}
                          label="Seconds"
                          value={String(revocationDelaySeconds)}
                          setValue={(v) => setRevocationDelaySeconds(parseInt(v || '0', 10))}
                        />
                      </div>
                    </div>
                    <div className="text-2xs text-neutral-500 mt-1 text-right">
                      {revocationDelaySeconds === 0
                        ? `Revoke credentials on ${provider.name} instantly after expiry`
                        : `Wait ${humanReadableDurationLong(revocationDelaySeconds)} after expiry before revoking credentials on ${provider.name}`}
                    </div>
                    {revocationDelaySeconds >= intervalSeconds && (
                      <div className="text-2xs text-red-500 mt-1">
                        Revocation delay must be less than the rotation interval.
                      </div>
                    )}
                  </div>

                  <div className="border-t border-neutral-500/20" />

                  <div>
                    <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                      Outputs
                    </div>
                    <div className="text-2xs text-neutral-500 mb-2">
                      Choose the secret key for each value the provider yields.
                    </div>
                    <div className="flex items-center gap-3 text-2xs font-medium uppercase tracking-wider text-gray-500 mb-1">
                      <div className="w-32">Secret in {provider.name}</div>
                      <div className="w-4" />
                      <div className="flex-1">Secret in Phase</div>
                    </div>
                    <div className="space-y-2">
                      {outputFields.map((field) => {
                        const entry = keyMap.find((k) => k.id === field.id)
                        return (
                          <div key={field.id} className="flex items-center gap-3">
                            <div className="w-32 font-mono text-2xs text-neutral-500">
                              {toUpper(field.id)}
                            </div>
                            <FaArrowRightLong className="text-neutral-500" />
                            <div className="flex-1">
                              <Input
                                className="font-mono ph-no-capture"
                                placeholder={`e.g. ${KEY_NAME_PREFIX[provider.id] ?? 'MY'}_API_KEY`}
                                value={entry?.keyName ?? ''}
                                setValue={(val) =>
                                  setKeyMap((prev) =>
                                    prev.map((k) =>
                                      k.id === field.id
                                        ? { ...k, keyName: val.replace(/ /g, '_').toUpperCase() }
                                        : k
                                    )
                                  )
                                }
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-neutral-500/20">
                <Button variant="secondary" type="button" onClick={prev}>
                  Back
                </Button>
                <Button variant="primary" type="submit" isLoading={creating}>
                  {step < steps.length - 1 ? 'Next' : 'Create and mint'}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </GenericDialog>
  )
})

CreateRotatingSecretDialog.displayName = 'CreateRotatingSecretDialog'
