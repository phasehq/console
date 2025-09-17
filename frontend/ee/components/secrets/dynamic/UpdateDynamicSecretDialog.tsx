import { forwardRef, useContext, useImperativeHandle, useRef, useState, useEffect } from 'react'
import {
  AwsConfigInput,
  DynamicSecretProviderType,
  EnvironmentType,
  ProviderCredentialsType,
  KeyMapInput,
  DynamicSecretType,
} from '@/apollo/graphql'
import { GetDynamicSecretProviders } from '@/graphql/queries/secrets/dynamic/getProviders.gql'
import { UpdateDynamicSecret } from '@/graphql/mutations/environments/secrets/dynamic/updateDynamicSecret.gql'
import GenericDialog from '@/components/common/GenericDialog'
import { Input } from '@/components/common/Input'
import { Button } from '@/components/common/Button'
import { Step, Stepper } from '@/components/onboarding/Stepper'
import { ProviderCredentialPicker } from '@/components/syncing/ProviderCredentialPicker'
import { organisationContext } from '@/contexts/organisationContext'
import { useMutation, useQuery } from '@apollo/client'
import { FaArrowRightLong } from 'react-icons/fa6'
import { MdOutlinePassword } from 'react-icons/md'
import { camelCase, toUpper } from 'lodash'
import { toast } from 'react-toastify'
import { FaCog, FaCogs } from 'react-icons/fa'
import { Textarea } from '@/components/common/TextArea'
import { encryptAsymmetric } from '@/utils/crypto'
import { leaseTtlButtons } from '@/utils/dynamicSecrets'

type UpdateDynamicSecretDialogRef = {
  openModal: () => void
  closeModal: () => void
}

interface UpdateDynamicSecretDialogProps {
  environment: EnvironmentType
  secret: DynamicSecretType // The secret to update
}

export const UpdateDynamicSecretDialog = forwardRef<
  UpdateDynamicSecretDialogRef,
  UpdateDynamicSecretDialogProps
>(({ secret, environment }, ref) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const [updateDynamicSecret] = useMutation(UpdateDynamicSecret)
  const dialogRef = useRef<{ closeModal: () => void; openModal: () => void }>(null)

  useImperativeHandle(ref, () => ({
    openModal: () => dialogRef.current?.openModal(),
    closeModal: () => dialogRef.current?.closeModal(),
  }))

  const [activeStep, setActiveStep] = useState(0)

  const nextStep = () => setActiveStep((s) => Math.min(s + 1, steps.length - 1))
  const prevStep = () => setActiveStep((s) => Math.max(s - 1, 0))

  const { data } = useQuery(GetDynamicSecretProviders)

  const provider: DynamicSecretProviderType = data?.dynamicSecretProviders.find(
    (p: DynamicSecretProviderType) => p.id === secret.provider.toLowerCase()
  )

  // Initialize form with existing secret config
  const [formData, setFormData] = useState({
    name: secret.name,
    description: secret.description ?? '',
    credential: secret.authentication as ProviderCredentialsType | null,
    config: secret.config as AwsConfigInput,
    keyMap: secret.keyMap as KeyMapInput[],
    defaultTTL: String(secret.defaultTtlSeconds ?? '3600'),
    maxTTL: String(secret.maxTtlSeconds ?? '86400'),
  })

  useEffect(() => {
    function sanitize(obj: any): any {
      if (Array.isArray(obj)) return obj.map(sanitize)
      if (obj && typeof obj === 'object') {
        const { __typename, masked, ...rest } = obj
        return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, sanitize(v)]))
      }
      return obj
    }
    setFormData({
      name: secret.name,
      description: secret.description ?? '',
      credential: sanitize(secret.authentication) as ProviderCredentialsType | null,
      config: sanitize(secret.config) as AwsConfigInput,
      keyMap: sanitize(secret.keyMap) as KeyMapInput[],
      defaultTTL: String(secret.defaultTtlSeconds ?? '3600'),
      maxTTL: String(secret.maxTtlSeconds ?? '86400'),
    })
  }, [secret])
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (activeStep < steps.length - 1) {
      nextStep()
    } else {
      // Validate credential
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

      // Encrypt each keyName in keyMap
      const encryptedKeyMap = await Promise.all(
        formData.keyMap.map(async (key) => ({
          ...key,
          keyName: key.keyName
            ? await encryptAsymmetric(key.keyName, environment.identityKey)
            : key.keyName,
        }))
      )

      await updateDynamicSecret({
        variables: {
          dynamicSecretId: secret.id,
          organisationId: organisation?.id,
          path: secret.path,
          name: formData.name,
          description: formData.description,
          defaultTtl: parseInt(formData.defaultTTL, 10),
          maxTtl: parseInt(formData.maxTTL, 10),
          authenticationId: formData.credential?.id ?? null,
          config: formData.config,
          keyMap: encryptedKeyMap,
        },
      })

      toast.success('Updated dynamic secret')
      dialogRef.current?.closeModal()
    }
  }

  const updateConfig = (key: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      config: { ...prev.config, [key]: value },
    }))
  }

  const ttlButtons = leaseTtlButtons

  return (
    <GenericDialog
      ref={dialogRef}
      title={`Configure Dynamic Secret`}
      buttonVariant="secondary"
      buttonContent={
        <>
          <FaCog /> Configure
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <Stepper steps={steps} activeStep={activeStep} align="left" />
        {activeStep === 0 && (
          <div className="space-y-4 divide-y divide-neutral-500/40 text-sm">
            <div>
              <ProviderCredentialPicker
                credential={formData.credential}
                setCredential={(cred) => setFormData({ ...formData, credential: cred })}
                orgId={organisation!.id}
                providerFilter={'aws'}
              />
            </div>

            {provider && (
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
            )}
          </div>
        )}
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
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">TTLs</div>
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
            <div className="space-y-4 pt-6">
              <div className="border-b border-neutral-500/20">
                <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Outputs</div>
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
        <div className="flex justify-between mt-6">
          <Button variant="secondary" type="button" onClick={prevStep} disabled={activeStep === 0}>
            Back
          </Button>
          <Button variant="primary" type="submit">
            {activeStep < steps.length - 1 ? 'Next' : 'Save'}
          </Button>
        </div>
      </form>
    </GenericDialog>
  )
})

UpdateDynamicSecretDialog.displayName = 'UpdateDynamicSecretDialog'
