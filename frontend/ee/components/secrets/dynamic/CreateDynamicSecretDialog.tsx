'use client'

import {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import {
  AwsConfigInput,
  DynamicSecretProviderType,
  EnvironmentType,
  ProviderCredentialsType,
  KeyMapInput,
} from '@/apollo/graphql'
import { GetDynamicSecretProviders } from '@/graphql/queries/secrets/dynamic/getProviders.gql'
import { CreateNewAWSDynamicSecret } from '@/graphql/mutations/environments/secrets/dynamic/createDynamicSecret.gql'
import { GetDynamicSecrets } from '@/graphql/queries/secrets/dynamic/getDynamicSecrets.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import GenericDialog from '@/components/common/GenericDialog'
import { Input } from '@/components/common/Input'
import { Button } from '@/components/common/Button'
import { FaCogs } from 'react-icons/fa'
import { Step, Stepper } from '@/components/onboarding/Stepper'
import { ProviderCredentialPicker } from '@/components/syncing/ProviderCredentialPicker'
import { organisationContext } from '@/contexts/organisationContext'
import { toUpper } from 'lodash'
import { useMutation, useQuery } from '@apollo/client'
import { Card } from '@/components/common/Card'
import { ProviderIcon } from '@/components/syncing/ProviderIcon'
import { FaArrowRightLong } from 'react-icons/fa6'
import { MdOutlinePassword } from 'react-icons/md'
import { camelCase } from 'lodash'
import { toast } from 'react-toastify'
import { EnableSSEDialog } from '@/components/apps/EnableSSEDialog'
import { leaseTtlButtons, MINIMUM_LEASE_TTL } from '@/utils/ttl'
import { Textarea } from '@/components/common/TextArea'
import { encryptAsymmetric } from '@/utils/crypto'

type CreateDynamicSecretDialogRef = {
  openModal: () => void
  closeModal: () => void
}

export interface CreateDynamicSecretInitialState {
  providerId: string
  authenticationId?: string | null
  config?: Record<string, unknown> | null
  keyMap?: Array<{ id: string; keyName: string }> | null
  name?: string | null
  description?: string | null
  defaultTtlSeconds?: number | null
  maxTtlSeconds?: number | null
}

interface CreateDynamicSecretDialogProps {
  environment: EnvironmentType
  path: string
  /** Optional prefill — seeded on dialog open. User can edit every field. */
  initialState?: CreateDynamicSecretInitialState | null
  /** Fired after a successful create + dialog close. */
  onCreated?: () => void
}

export const CreateDynamicSecretDialog = forwardRef<
  CreateDynamicSecretDialogRef,
  CreateDynamicSecretDialogProps
>(({ environment, path, initialState, onCreated }, ref) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data } = useQuery(GetDynamicSecretProviders)
  const { data: savedCredentialsData } = useQuery(GetSavedCredentials, {
    variables: { orgId: organisation?.id },
    skip: !organisation,
  })

  const [createDynamicSecret] = useMutation(CreateNewAWSDynamicSecret)

  const dialogRef = useRef<{ closeModal: () => void; openModal: () => void }>(null)

  useImperativeHandle(ref, () => ({
    openModal: () => dialogRef.current?.openModal(),
    closeModal: () => dialogRef.current?.closeModal(),
  }))

  const [provider, setProvider] = useState<DynamicSecretProviderType | null>(null)
  const [activeStep, setActiveStep] = useState(0)
  const [formData, setFormData] = useState({
    name: 'AWS IAM credentials',
    description: '',
    credential: null as ProviderCredentialsType | null,
    config: {
      usernameTemplate: '{{random}}',
      iamPath: `/phase/`,
      permissionBoundaryArn: undefined,
      groups: '',
      policyArns: '',
      policyDocument: undefined,
    } as AwsConfigInput,
    keyMap: [] as KeyMapInput[],
    defaultTTL: '3600',
    maxTTL: '86400',
  })

  const handleCredentialChange = useCallback((cred: ProviderCredentialsType) => {
    setFormData((prev) => ({ ...prev, credential: cred }))
  }, [])

  // Tracks whether we've already applied the prefill on this dialog open.
  const prefillAppliedRef = useRef(false)

  const reset = () => {
    setProvider(null)
    setActiveStep(0)
    setFormData({
      name: 'AWS IAM credentials',
      description: '',
      credential: null as ProviderCredentialsType | null,
      config: {
        usernameTemplate: '{{random}}',
        iamPath: `/phase/`,
        permissionBoundaryArn: undefined,
        groups: '',
        policyArns: '',
        policyDocument: undefined,
      } as AwsConfigInput,
      keyMap: [] as KeyMapInput[],
      defaultTTL: '3600',
      maxTTL: '86400',
    })
    prefillAppliedRef.current = false
  }

  useEffect(() => {
    if (!provider) return

    const initialKeyMap: KeyMapInput[] = provider.credentials.map((cred: any) => {
      const fromPrefill = initialState?.keyMap?.find((k) => k.id === cred.id)
      return {
        id: cred.id,
        keyName: fromPrefill?.keyName ?? (cred.default_key_name || ''),
      }
    })

    // Always re-derive iamPath for the target env — never copy from source.
    const derivedIamPath = `/phase/${organisation?.name}/${environment.app.name}/${environment.name}${path}`
    const baseConfig: AwsConfigInput = {
      usernameTemplate: '{{random}}',
      iamPath: derivedIamPath,
      permissionBoundaryArn: undefined,
      groups: '',
      policyArns: '',
      policyDocument: undefined,
    }
    let mergedConfig: AwsConfigInput = baseConfig
    if (initialState?.config) {
      // Source config comes from the backend JSONField in snake_case
      // (provider-native). Convert keys to camelCase to match the GraphQL
      // input shape and drop iam_path/iamPath so we always re-derive it
      // for the target env.
      const sourceCamel: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(initialState.config as Record<string, unknown>)) {
        const ck = camelCase(k)
        if (ck === 'iamPath') continue
        sourceCamel[ck] = v
      }
      mergedConfig = { ...baseConfig, ...(sourceCamel as AwsConfigInput), iamPath: derivedIamPath }
    }

    setFormData((prev) => ({
      ...prev,
      name: initialState?.name ?? prev.name,
      description: initialState?.description ?? prev.description,
      defaultTTL: initialState?.defaultTtlSeconds
        ? String(initialState.defaultTtlSeconds)
        : prev.defaultTTL,
      maxTTL: initialState?.maxTtlSeconds ? String(initialState.maxTtlSeconds) : prev.maxTTL,
      config: mergedConfig,
      keyMap: initialKeyMap,
    }))
  }, [environment.app.name, environment.name, organisation?.name, path, provider, initialState])

  // Auto-select the provider when prefill arrives + providers list is ready.
  useEffect(() => {
    if (!initialState || prefillAppliedRef.current || !data) return
    const target = (data.dynamicSecretProviders as DynamicSecretProviderType[] | undefined)?.find(
      (p) => p.id === initialState.providerId
    )
    if (target) {
      setProvider(target)
      prefillAppliedRef.current = true
    }
  }, [initialState, data])

  // Auto-select the credential once GetSavedCredentials resolves.
  useEffect(() => {
    if (!initialState?.authenticationId) return
    if (formData.credential) return
    const list =
      (savedCredentialsData?.savedCredentials as ProviderCredentialsType[] | undefined) ?? []
    const match = list.find((c) => c.id === initialState.authenticationId)
    if (match) setFormData((prev) => ({ ...prev, credential: match }))
  }, [initialState?.authenticationId, savedCredentialsData, formData.credential])

  const steps: Step[] = [
    {
      index: 0,
      name: 'Provider',
      icon: <FaCogs />,
      title: 'Provider Config',
      description: 'Enter provider-specific configuration',
    },
    {
      index: 1,
      name: 'Config',
      icon: <MdOutlinePassword />,
      title: 'Config',
      description: 'Define how secrets are created and mapped to outputs',
    },
  ]

  const nextStep = () => setActiveStep((s) => Math.min(s + 1, steps.length - 1))
  const prevStep = () => setActiveStep((s) => Math.max(s - 1, 0))

  const updateConfig = (key: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      config: { ...prev.config, [key]: value },
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (activeStep < steps.length - 1) {
      nextStep()
    } else {
      // Ensure credentials are selected
      if (formData.credential === null) {
        toast.error('Please select authentication credentials!')
        return false
      }

      // Validate username template
      const template = formData.config.usernameTemplate ?? ''
      const randomPlaceholderRegex = /\{\{\s*random\s*\}\}/i

      if (!randomPlaceholderRegex.test(template)) {
        toast.error('Username template must include {{random}} to generate unique usernames.')
        return false
      }

      if (parseInt(formData.defaultTTL, 10) > parseInt(formData.maxTTL, 10)) {
        toast.error('Default TTL must be less than or equal to Max TTL')
        return false
      }

      if (parseInt(formData.maxTTL, 10) <= MINIMUM_LEASE_TTL) {
        toast.error(`Max TTL must be greater than ${MINIMUM_LEASE_TTL} seconds`)
        return false
      }

      // Encrypt each keyName in keyMap
      const encryptedKeyMap = await Promise.all(
        formData.keyMap.map(async (key) => ({
          ...key,
          keyName: key.keyName
            ? await encryptAsymmetric(key.keyName, environment.identityKey)
            : key.keyName,
        }))
      )

      await createDynamicSecret({
        variables: {
          organisationId: organisation?.id,
          environmentId: environment.id,
          path,
          name: formData.name,
          description: formData.description,
          defaultTtl: parseInt(formData.defaultTTL, 10),
          maxTtl: parseInt(formData.maxTTL, 10),
          authenticationId: formData.credential?.id ?? null,
          config: formData.config,
          keyMap: encryptedKeyMap,
        },
        refetchQueries: [{ query: GetDynamicSecrets, variables: { orgId: organisation?.id } }],
      })

      toast.success('Created new dynamic secret')
      reset()
      dialogRef.current?.closeModal()
      onCreated?.()
    }
  }

  const ttlButtons = leaseTtlButtons

  const ProviderMenu = () => (
    <div className="grid">
      {data?.dynamicSecretProviders?.map((provider: DynamicSecretProviderType) => (
        <div className="cursor-pointer" key={provider.id} onClick={() => setProvider(provider)}>
          <Card>
            <div>
              <div className="flex items-center gap-3">
                <div className="text-2xl">
                  <ProviderIcon providerId={provider.id} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {provider.name}
                  </div>
                  <div className="text-neutral-500 text-2xs">
                    Set up a dynamic secret for {provider.name}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      ))}
    </div>
  )

  return (
    <GenericDialog ref={dialogRef} title={`Set up a Dynamic Secret`}>
      {!environment.app.sseEnabled ? (
        <div className="space-y-4 pt-4">
          <div>
            <div className="text-sm font-semibold text-black dark:text-white">
              Server-side encryption (SSE)
            </div>
            <div className="text-neutral-500 text-2xs">
              Server-side encryption is required to use Dynamic Secrets. Click the button below to
              enable SSE.
            </div>
          </div>

          <div className="flex justify-start">
            <EnableSSEDialog appId={environment.app.id} />
          </div>
        </div>
      ) : (
        <div className="space-y-4 pt-4">
          <div className="text-neutral-500 text-xs">Configure a new dynamic secret</div>

          {!provider && <ProviderMenu />}
          {provider && (
            <form onSubmit={handleSubmit}>
              <Stepper steps={steps} activeStep={activeStep} align="left" />

              {/* Step 2: Config */}
              {activeStep === 0 && (
                <div className="divide-y divide-neutral-500/40 text-sm">
                  <div className="mt-2">
                    <ProviderCredentialPicker
                      credential={formData.credential}
                      setCredential={handleCredentialChange}
                      orgId={organisation!.id}
                      providerFilter={provider.id}
                      setDefault
                    />
                  </div>
                  <div className="space-y-3 py-2">
                    {provider.configMap.map(
                      (field: {
                        id: keyof AwsConfigInput
                        label: string
                        help_text?: string
                        required?: boolean
                        default?: any
                      }) => (
                        <Textarea
                          key={field.id}
                          label={field.label}
                          placeholder={field.help_text}
                          required={field.required}
                          value={
                            formData.config[camelCase(field.id) as keyof AwsConfigInput] ??
                            field.default ??
                            ''
                          }
                          setValue={(val) => updateConfig(camelCase(field.id), val)}
                        />
                      )
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: Key Mapping */}
              {activeStep === 1 && (
                <div className="divide-y divide-neutral-500/40 text-sm">
                  <div className="space-y-3 py-2">
                    <Input
                      label="Name"
                      required
                      placeholder="The name for this dynamic secret"
                      value={formData.name}
                      setValue={(val) => setFormData({ ...formData, name: val })}
                    />
                    <Input
                      label="Description"
                      placeholder="Optional description for this dynamic secret"
                      value={formData.description}
                      setValue={(val) => setFormData({ ...formData, description: val })}
                    />
                  </div>

                  <div className="space-y-3 py-2">
                    <div>
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        TTLs
                      </div>
                      <div className="text-neutral-500 text-xs">
                        Configure the default and max TTLs for generated secrets
                      </div>
                    </div>

                    <div className="flex items-end gap-4 justify-between">
                      <Input
                        value={formData.maxTTL}
                        setValue={(val) => setFormData({ ...formData, maxTTL: val })}
                        type="number"
                        min={60}
                        label="Max TTL (seconds)"
                        max={formData.maxTTL!}
                        required
                      />

                      <div className="flex items-center gap-2 py-1">
                        {ttlButtons.map((button) => (
                          <Button
                            type="button"
                            variant={formData.maxTTL === button.seconds ? 'secondary' : 'ghost'}
                            key={button.label}
                            onClick={() => setFormData({ ...formData, maxTTL: button.seconds })}
                          >
                            {button.label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-end gap-4 justify-between">
                      <Input
                        value={formData.defaultTTL}
                        setValue={(val) => setFormData({ ...formData, defaultTTL: val })}
                        type="number"
                        min={60}
                        label="Default TTL (seconds)"
                        max={formData.maxTTL!}
                        required
                      />

                      <div className="flex items-center gap-2 py-1">
                        {ttlButtons.map((button) => (
                          <Button
                            type="button"
                            variant={formData.defaultTTL === button.seconds ? 'secondary' : 'ghost'}
                            key={button.label}
                            onClick={() => setFormData({ ...formData, defaultTTL: button.seconds })}
                          >
                            {button.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 py-2">
                    <div>
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Outputs
                      </div>
                      <div className="text-neutral-500 text-xs">
                        Configure how generated secrets are mapped to keys in your environment
                      </div>
                    </div>

                    {formData.keyMap.map((key) => (
                      <div key={key.id} className="flex items-center gap-4">
                        <div className="flex-1 font-mono text-sm text-zinc-900 dark:text-zinc-100">
                          {toUpper(key.id)}
                        </div>
                        <FaArrowRightLong className="text-neutral-500" />
                        <div className="flex-1">
                          <Input
                            className="font-mono ph-no-capture"
                            placeholder="Enter secret name"
                            value={key.keyName ?? ''}
                            setValue={(val) =>
                              setFormData((prev) => ({
                                ...prev,
                                keyMap: prev.keyMap.map((k) =>
                                  k.id === key.id
                                    ? { ...k, keyName: val.replace(/ /g, '_').toUpperCase() }
                                    : k
                                ),
                              }))
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-between mt-4">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={prevStep}
                  disabled={activeStep === 0}
                >
                  Back
                </Button>
                <Button variant="primary" type="submit">
                  {activeStep < steps.length - 1 ? 'Next' : 'Finish'}
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </GenericDialog>
  )
})

CreateDynamicSecretDialog.displayName = 'CreateDynamicSecretDialog'
