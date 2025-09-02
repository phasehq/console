'use client'

import { forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  AwsConfigInput,
  DynamicSecretProviderType,
  EnvironmentType,
  ProviderCredentialsType,
  KeyMapInput,
  DynamicSecretType,
} from '@/apollo/graphql'
import { GetDynamicSecretProviders } from '@/graphql/queries/secrets/dynamic/getProviders.gql'
import { CreateNewAWSDynamicSecret } from '@/graphql/mutations/environments/secrets/dynamic/createDynamicSecret.gql'
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
import { MINIMUM_LEASE_TTL } from '@/utils/dynamicSecrets'
import { Textarea } from '@/components/common/TextArea'
import { encryptAsymmetric } from '@/utils/crypto'

type CreateDynamicSecretDialogRef = {
  openModal: () => void
  closeModal: () => void
}

interface CreateDynamicSecretDialogProps {
  environment: EnvironmentType
  path: string
}

export const CreateDynamicSecretDialog = forwardRef<
  CreateDynamicSecretDialogRef,
  CreateDynamicSecretDialogProps
>(({ environment, path }, ref) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { data } = useQuery(GetDynamicSecretProviders)

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
      groups: [],
      policyArns: [],
      policyDocument: undefined,
    } as AwsConfigInput,
    keyMap: [] as KeyMapInput[],
    defaultTTL: '3600',
    maxTTL: '86400',
  })

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
        groups: [],
        policyArns: [],
        policyDocument: undefined,
      } as AwsConfigInput,
      keyMap: [] as KeyMapInput[],
      defaultTTL: '3600',
      maxTTL: '86400',
    })
  }

  useEffect(() => {
    if (!provider) return

    const initialKeyMap: KeyMapInput[] = provider.credentials.map((cred: any) => {
      return {
        id: cred.id,
        keyName: cred.default_key_name || '',
      }
    })

    setFormData({
      name: 'AWS IAM credentials',
      description: '',
      credential: null,
      config: {
        usernameTemplate: '{{random}}',
        iamPath: `/phase/${organisation?.name}/${environment.app.name}/${environment.name}${path}`,
      },
      keyMap: initialKeyMap,
      defaultTTL: '3600',
      maxTTL: '86400',
    })
  }, [environment.app.name, environment.name, organisation?.name, path, provider])

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
      }

      if (parseInt(formData.maxTTL, 10) <= MINIMUM_LEASE_TTL) {
        toast.error(`Max TTL must be greater than ${MINIMUM_LEASE_TTL} seconds`)
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
      })

      toast.success('Created new dynamic secret')
      reset()
      dialogRef.current?.closeModal()
    }
  }

  const ProviderMenu = () => (
    <div className="grid">
      {data?.dynamicSecretProviders?.map((provider: DynamicSecretProviderType) => (
        <div className="cursor-pointer" key={provider.id} onClick={() => setProvider(provider)}>
          <Card>
            <div>
              <div className="flex items-center gap-2 ">
                <div className="text-5xl">
                  <ProviderIcon providerId={provider.id} />
                </div>
                <div>
                  <div className="text-xl font-semibold">{provider.name}</div>
                  <div className="text-neutral-500">
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
        <div className="space-y-6">
          <div className="py-4">
            <div className="text-lg font-semibold text-black dark:text-white">
              Server-side encryption (SSE)
            </div>
            <div className="text-neutral-500">
              Server-side encryption is required to use Dynamic Secrets. Click the button below to
              enable SSE.
            </div>
          </div>

          <div className="flex justify-start">
            <EnableSSEDialog appId={environment.app.id} />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-neutral-500">Configure a new dynamic secret</div>

          {!provider && <ProviderMenu />}
          {provider && (
            <form onSubmit={handleSubmit}>
              <Stepper steps={steps} activeStep={activeStep} align="left" />

              {/* Step 2: Config */}
              {activeStep === 0 && (
                <div className="space-y-4 divide-y divide-neutral-500/40 text-sm">
                  <div>
                    <ProviderCredentialPicker
                      credential={formData.credential}
                      setCredential={(cred) => setFormData({ ...formData, credential: cred })}
                      orgId={organisation!.id}
                      providerFilter={provider.id}
                    />
                  </div>
                  <div className="space-y-4 pt-2">
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
                <div className="space-y-6 divide-y divide-neutral-500/40 text-sm">
                  <div className="space-y-4">
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

                  <div className="space-y-4 pt-6">
                    <div className="border-b border-neutral-500/20">
                      <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        TTLs
                      </div>
                      <div className="text-neutral-500 text-xs">
                        Configure the default and max TTLs for generated secrets
                      </div>
                    </div>
                    <Input
                      type="number"
                      label="Default TTL (seconds)"
                      required
                      min={1}
                      value={formData.defaultTTL}
                      setValue={(val) => setFormData({ ...formData, defaultTTL: val })}
                    />
                    <Input
                      type="number"
                      label="Max TTL (seconds)"
                      required
                      min={1}
                      value={formData.maxTTL}
                      setValue={(val) => setFormData({ ...formData, maxTTL: val })}
                    />
                  </div>

                  <div className="space-y-4 pt-6">
                    <div className="border-b border-neutral-500/20">
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
                            className="font-mono"
                            placeholder="Enter secret name"
                            value={key.keyName ?? ''}
                            setValue={(val) =>
                              setFormData((prev) => ({
                                ...prev,
                                keyMap: prev.keyMap.map((k) =>
                                  k.id === key.id ? { ...k, keyName: val } : k
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

              <div className="flex justify-between mt-6">
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
