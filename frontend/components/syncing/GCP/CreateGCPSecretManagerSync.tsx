import GetGcpSecretManagerSecrets from '@/graphql/queries/syncing/gcp/getGcpSecrets.gql'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import CreateNewGcpSecretManagerSync from '@/graphql/mutations/syncing/gcp/createGcpSecretManagerSync.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useState } from 'react'
import { Combobox, RadioGroup, Transition } from '@headlessui/react'
import clsx from 'clsx'
import {
  FaAngleDoubleDown,
  FaChevronDown,
  FaCircle,
  FaDotCircle,
  FaExternalLinkAlt,
  FaKey,
} from 'react-icons/fa'
import { SiGooglecloud } from 'react-icons/si'
import { toast } from 'react-toastify'
import { EnvironmentType, GcpSecretType, ProviderCredentialsType } from '@/apollo/graphql'
import { Button } from '@/components/common/Button'
import { Input } from '@/components/common/Input'
import { Alert } from '@/components/common/Alert'
import { organisationContext } from '@/contexts/organisationContext'
import {
  GCP_GLOBAL_LOCATION,
  GCP_PREFIX_REGEX,
  GCP_PROJECT_ID_REGEX,
  GCP_SECRET_ID_REGEX,
  gcpKmsGrantScript,
  kmsKeyNameError,
  parseWorkloadIdentityProvider,
} from '@/utils/syncing/gcp'
import { ProviderCredentialPicker } from '../ProviderCredentialPicker'
import { GCPLocationPicker } from './GCPLocationPicker'
import { GCPScriptBlock } from './GCPScriptTabs'

const sanitizeSecretName = (name: string) =>
  name.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-{2,}/g, '-')

const Choice = (props: { selected: boolean; onClick: () => void; children: React.ReactNode }) => (
  <div
    role="button"
    onClick={props.onClick}
    className={clsx(
      'flex items-center gap-2 py-1 px-2 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 border border-zinc-200 dark:border-zinc-800 rounded-full text-zinc-900 dark:text-zinc-100',
      props.selected ? 'bg-zinc-200 dark:bg-zinc-700' : 'bg-zinc-100 dark:bg-zinc-800'
    )}
  >
    {props.selected ? <FaDotCircle className="text-emerald-500" /> : <FaCircle />}
    {props.children}
  </div>
)

export const CreateGCPSecretManagerSync = (props: { appId: string; closeModal: () => void }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { appId, closeModal } = props

  const { data: appEnvsData } = useQuery(GetAppEnvironments, { variables: { appId } })
  const [getGcpSecrets, { loading }] = useLazyQuery(GetGcpSecretManagerSecrets, {
    fetchPolicy: 'network-only',
  })
  const [createGcpSync, { loading: creating }] = useMutation(CreateNewGcpSecretManagerSync)

  const [credential, setCredential] = useState<ProviderCredentialsType | null>(null)
  const [projectId, setProjectId] = useState('')
  const [location, setLocation] = useState(GCP_GLOBAL_LOCATION)
  const [accessError, setAccessError] = useState<string | null>(null)
  const [gcpSecrets, setGcpSecrets] = useState<GcpSecretType[]>([])
  const [credentialsValid, setCredentialsValid] = useState(false)

  const [syncMode, setSyncMode] = useState<'individual' | 'blob'>('individual')
  const [prefix, setPrefix] = useState('')
  const [createNewSecret, setCreateNewSecret] = useState(true)
  const [newSecretName, setNewSecretName] = useState('')
  const [secretNameIsCustom, setSecretNameIsCustom] = useState(false)
  const [existingSecret, setExistingSecret] = useState<GcpSecretType | null>(null)
  const [secretQuery, setSecretQuery] = useState('')
  const [kmsKeyName, setKmsKeyName] = useState('')

  const [phaseEnv, setPhaseEnv] = useState<EnvironmentType | null>(null)
  const [path, setPath] = useState('/')
  const [consentGiven, setConsentGiven] = useState(false)

  useEffect(() => {
    if (appEnvsData?.appEnvironments.length > 0) setPhaseEnv(appEnvsData.appEnvironments[0])
  }, [appEnvsData])

  useEffect(() => {
    if (phaseEnv && !secretNameIsCustom)
      setNewSecretName(sanitizeSecretName(`${phaseEnv.app.name}-${phaseEnv.name}`).toLowerCase())
  }, [phaseEnv, secretNameIsCustom])

  const credentialValues: Record<string, string> = credential?.credentials
    ? JSON.parse(credential.credentials)
    : {}
  // The project holding the credential's pool, where the setup script
  // granted Secret Manager access. Secret Manager takes the number as a
  // project ID, so it's the default destination.
  const credentialProject =
    parseWorkloadIdentityProvider(credentialValues['workload_identity_provider'] ?? '')
      ?.projectNumber ?? ''

  useEffect(() => {
    setProjectId(credentialProject)
  }, [credential?.id, credentialProject])

  const projectIdIsValid = GCP_PROJECT_ID_REGEX.test(projectId.trim())
  const kmsError = kmsKeyNameError(kmsKeyName.trim(), location)
  const secretName = createNewSecret ? newSecretName : existingSecret?.name ?? ''
  const filteredSecrets =
    secretQuery === ''
      ? gcpSecrets
      : gcpSecrets.filter((secret) =>
          secret.name?.toLowerCase().includes(secretQuery.toLowerCase())
        )

  const checkAccess = async () => {
    if (!credential) {
      toast.error('Please select credentials to use for this sync')
      return
    }
    setAccessError(null)
    const { data, error } = await getGcpSecrets({
      variables: { credentialId: credential.id, projectId: projectId.trim(), location },
    })
    if (error || !data) {
      setAccessError(error?.message ?? 'Could not reach GCP Secret Manager.')
      return
    }
    setGcpSecrets((data.gcpSecretManagerSecrets ?? []).filter(Boolean))
    setCredentialsValid(true)
  }

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (!credentialsValid) {
      await checkAccess()
      return
    }

    if (syncMode === 'blob' && !GCP_SECRET_ID_REGEX.test(secretName)) {
      toast.error('Choose a secret name: letters, numbers, hyphens and underscores only')
      return
    }
    if (kmsError) {
      toast.error(kmsError)
      return
    }

    try {
      await createGcpSync({
        variables: {
          envId: phaseEnv?.id,
          path,
          credentialId: credential!.id,
          projectId: projectId.trim(),
          location,
          syncMode,
          secretName: syncMode === 'blob' ? secretName : null,
          prefix: syncMode === 'individual' ? prefix.trim() : null,
          kmsKeyName: kmsKeyName.trim() || null,
        },
        refetchQueries: [{ query: GetAppSyncStatus, variables: { appId } }],
      })
      toast.success('Created new Sync!')
      closeModal()
    } catch (error: any) {
      toast.error(error.message ?? 'Failed to create sync')
    }
  }

  const exampleKey = 'DATABASE_URL'

  const consentPoints =
    syncMode === 'individual'
      ? [
          'Phase will overwrite GCP secrets with the same names',
          "Phase will disable the GCP secrets it created when they're deleted in Phase",
          'Only the current and previous versions of each secret are kept',
        ]
      : ['Phase will overwrite this GCP secret', 'Only its current and previous versions are kept']

  return (
    <div className="p-4 space-y-6">
      <div>
        <div className="text-2xl font-semibold flex items-center gap-2 text-black dark:text-white">
          <SiGooglecloud className="text-[#4285F4]" />
          GCP Secret Manager
        </div>
        <div className="text-neutral-500">
          Sync an environment with Google Cloud Secret Manager.
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {!credentialsValid && (
          <div className="space-y-4">
            <div className="font-medium text-black dark:text-white">
              Step 1: Choose credentials and a destination
            </div>
            <ProviderCredentialPicker
              credential={credential}
              setCredential={(cred) => {
                setCredential(cred)
                setAccessError(null)
              }}
              orgId={organisation!.id}
              providerFilter="gcp"
              setDefault={true}
            />
            <Input
              value={projectId}
              setValue={(value) => {
                setProjectId(value)
                setAccessError(null)
              }}
              label="Project"
              placeholder="my-project"
              required
            />
            {projectId && !projectIdIsValid ? (
              <p className="text-red-500 text-xs">
                Use the project ID (e.g. my-project) or project number.
              </p>
            ) : (
              <p className="text-neutral-500 text-2xs">
                Defaults to the project that holds this credential&apos;s Workload Identity pool.
              </p>
            )}
            <GCPLocationPicker value={location} onChange={setLocation} />

            {accessError && (
              <Alert variant="danger" icon size="sm">
                <div className="text-xs">{accessError}</div>
              </Alert>
            )}
          </div>
        )}

        {credentialsValid && (
          <div className="space-y-6">
            <div className="space-y-4">
              <RadioGroup value={phaseEnv} onChange={setPhaseEnv}>
                <RadioGroup.Label as={Fragment}>
                  <label className="block text-neutral-500 text-sm mb-2">Phase Environment</label>
                </RadioGroup.Label>
                <div className="flex flex-wrap items-center gap-2">
                  {appEnvsData.appEnvironments.map((env: EnvironmentType) => (
                    <RadioGroup.Option key={env.id} value={env} as={Fragment}>
                      {({ active, checked }) => (
                        <div
                          className={clsx(
                            'flex items-center gap-2 py-1 px-2 cursor-pointer bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 rounded-full capitalize text-zinc-900 dark:text-zinc-100',
                            active && 'border-zinc-300 dark:border-zinc-700',
                            checked && 'bg-zinc-200 dark:bg-zinc-700'
                          )}
                        >
                          {checked ? <FaDotCircle className="text-emerald-500" /> : <FaCircle />}
                          {env.name}
                        </div>
                      )}
                    </RadioGroup.Option>
                  ))}
                </div>
              </RadioGroup>

              <Input value={path} setValue={setPath} label="Path" />
            </div>

            <div className="flex justify-between items-center gap-4 py-4">
              <div className="border-b border-neutral-500/40 w-full"></div>
              <FaAngleDoubleDown className="shrink-0 text-neutral-500 text-2xl" />
              <div className="border-b border-neutral-500/40 w-full"></div>
            </div>

            <div className="space-y-4">
              <div className="flex items-baseline justify-between gap-4">
                <div className="font-medium text-black dark:text-white">Secret mapping</div>
                <code className="text-2xs text-neutral-500">
                  projects/{projectId.trim()} · {location}
                </code>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Choice
                  selected={syncMode === 'individual'}
                  onClick={() => setSyncMode('individual')}
                >
                  One secret per key
                </Choice>
                <Choice selected={syncMode === 'blob'} onClick={() => setSyncMode('blob')}>
                  Single JSON secret
                </Choice>
              </div>

              {syncMode === 'individual' && (
                <div className="space-y-2">
                  <div className="text-sm text-neutral-500">
                    Each Phase secret becomes its own GCP secret, named after its key.
                  </div>
                  <Input
                    value={prefix}
                    setValue={setPrefix}
                    label="Name prefix (optional)"
                    placeholder="PROD_"
                    maxLength={64}
                  />
                  {GCP_PREFIX_REGEX.test(prefix.trim()) ? (
                    <p className="text-neutral-500 text-2xs">
                      {exampleKey} →{' '}
                      <code>
                        {prefix.trim() || 'PROD_'}
                        {exampleKey}
                      </code>
                    </p>
                  ) : (
                    <p className="text-red-500 text-xs">
                      Only letters, numbers, hyphens and underscores are allowed.
                    </p>
                  )}
                </div>
              )}

              {syncMode === 'blob' && (
                <div className="space-y-4">
                  <div className="text-sm text-neutral-500">
                    All Phase secrets are synced as one JSON object to a single GCP secret.
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Choice selected={createNewSecret} onClick={() => setCreateNewSecret(true)}>
                      Create new secret
                    </Choice>
                    <Choice selected={!createNewSecret} onClick={() => setCreateNewSecret(false)}>
                      Overwrite existing secret
                    </Choice>
                  </div>

                  {createNewSecret ? (
                    <div className="space-y-2">
                      <Input
                        value={newSecretName}
                        setValue={(value) => {
                          setNewSecretName(value)
                          setSecretNameIsCustom(true)
                        }}
                        label="New secret name"
                        required
                        maxLength={255}
                      />
                      {newSecretName && !GCP_SECRET_ID_REGEX.test(newSecretName) && (
                        <p className="text-red-500 text-xs">
                          Only letters, numbers, hyphens and underscores are allowed.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="relative">
                      <Combobox as="div" value={existingSecret} onChange={setExistingSecret}>
                        {({ open }) => (
                          <>
                            <div className="space-y-2">
                              <Combobox.Label as={Fragment}>
                                <label className="block text-neutral-500 text-sm">Secret</label>
                              </Combobox.Label>
                              <div className="w-full relative flex items-center">
                                <Combobox.Input
                                  className="w-full"
                                  onChange={(event) => setSecretQuery(event.target.value)}
                                  required
                                  displayValue={(secret: GcpSecretType) => secret?.name ?? ''}
                                  placeholder="Search secrets..."
                                />
                                <div className="absolute inset-y-0 right-2 flex items-center">
                                  <Combobox.Button>
                                    <FaChevronDown
                                      className={clsx(
                                        'text-neutral-500 transform transition ease cursor-pointer',
                                        open ? 'rotate-180' : 'rotate-0'
                                      )}
                                    />
                                  </Combobox.Button>
                                </div>
                              </div>
                            </div>
                            <Transition
                              enter="transition duration-100 ease-out"
                              enterFrom="transform scale-95 opacity-0"
                              enterTo="transform scale-100 opacity-100"
                              leave="transition duration-75 ease-out"
                              leaveFrom="transform scale-100 opacity-100"
                              leaveTo="transform scale-95 opacity-0"
                            >
                              <Combobox.Options as={Fragment}>
                                <div className="bg-zinc-300 dark:bg-zinc-800 p-2 rounded-b-md shadow-2xl z-20 absolute max-h-60 overflow-y-auto w-full border border-t-none border-neutral-500/20 divide-y divide-neutral-500/20">
                                  {filteredSecrets.length === 0 ? (
                                    <div className="p-2 text-sm text-neutral-500">
                                      No secrets found.
                                    </div>
                                  ) : (
                                    filteredSecrets.map((secret) => (
                                      <Combobox.Option as="div" key={secret.name} value={secret}>
                                        {({ active }) => (
                                          <div
                                            className={clsx(
                                              'flex items-center gap-2 p-2 cursor-pointer rounded-md w-full',
                                              active && 'bg-zinc-400 dark:bg-zinc-700'
                                            )}
                                          >
                                            <FaKey className="shrink-0 text-neutral-500" />
                                            <div className="font-semibold text-black dark:text-white">
                                              {secret.name}
                                            </div>
                                            {secret.managedByPhase && (
                                              <span className="text-2xs text-emerald-500">
                                                Phase
                                              </span>
                                            )}
                                          </div>
                                        )}
                                      </Combobox.Option>
                                    ))
                                  )}
                                </div>
                              </Combobox.Options>
                            </Transition>
                          </>
                        )}
                      </Combobox>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Input
                  value={kmsKeyName}
                  setValue={setKmsKeyName}
                  label="KMS: Customer-managed encryption key (optional)"
                  placeholder={`projects/my-project/locations/${location}/keyRings/my-ring/cryptoKeys/my-key`}
                />
                {kmsError ? (
                  <p className="text-red-500 text-xs">{kmsError}</p>
                ) : kmsKeyName.trim() ? (
                  <>
                    <div className="overflow-hidden rounded-lg border border-neutral-500/40">
                      <GCPScriptBlock
                        script={gcpKmsGrantScript({ project: projectId, kmsKeyName })}
                      />
                    </div>
                    <p className="text-neutral-500 text-xs">
                      Run this in{' '}
                      <a
                        href="https://shell.cloud.google.com/?show=terminal"
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-500 inline-flex items-center gap-1"
                      >
                        Cloud Shell <FaExternalLinkAlt className="text-2xs" />
                      </a>{' '}
                      or any terminal where gcloud can manage the key, before you create the sync.
                      Secret Manager encrypts through the project&apos;s service agent, so the agent
                      needs access to the key; Phase doesn&apos;t. It&apos;s safe to run again.
                    </p>
                  </>
                ) : (
                  <p className="text-neutral-500 text-2xs">
                    Leave empty to use Google-managed keys for secret encryption.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {credentialsValid && (
          <div className="pt-8">
            <Alert variant="info">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                  className="accent-emerald-500 mt-1"
                />
                <span className="block space-y-1">
                  <span className="block">
                    I understand that:<span className="text-red-500 ml-0.5">*</span>
                  </span>
                  {consentPoints.map((point) => (
                    <span key={point} className="flex gap-2 pl-1">
                      <span aria-hidden="true">•</span>
                      {point}
                    </span>
                  ))}
                </span>
              </label>
            </Alert>
          </div>
        )}

        <div className="flex items-center justify-between pt-4">
          <div>
            {credentialsValid && (
              <Button
                variant="secondary"
                type="button"
                onClick={() => {
                  // The next project or location may not have the same secrets.
                  setCredentialsValid(false)
                  setExistingSecret(null)
                  setSecretQuery('')
                  setConsentGiven(false)
                }}
              >
                Back
              </Button>
            )}
          </div>
          <Button
            isLoading={loading || creating}
            variant="primary"
            type="submit"
            disabled={credentialsValid ? !consentGiven : !projectIdIsValid}
          >
            {credentialsValid ? 'Create' : 'Next'}
          </Button>
        </div>
      </form>
    </div>
  )
}
