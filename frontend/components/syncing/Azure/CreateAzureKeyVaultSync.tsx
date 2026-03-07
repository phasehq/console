import GetAzureKeyVaultSecrets from '@/graphql/queries/syncing/azure/getKeyVaultSecrets.gql'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import CreateNewAzureKeyVaultSync from '@/graphql/mutations/syncing/azure/createAzureKeyVaultSync.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useState } from 'react'
import { Button } from '../../common/Button'
import { AzureKeyVaultSecretType, EnvironmentType, ProviderCredentialsType } from '@/apollo/graphql'
import { Combobox, RadioGroup, Transition } from '@headlessui/react'
import clsx from 'clsx'
import {
  FaAngleDoubleDown,
  FaChevronDown,
  FaCircle,
  FaDotCircle,
  FaKey,
} from 'react-icons/fa'
import { toast } from 'react-toastify'
import { VscAzure } from 'react-icons/vsc'
import { ProviderCredentialPicker } from '../ProviderCredentialPicker'
import { organisationContext } from '@/contexts/organisationContext'
import { Input } from '@/components/common/Input'

const AZ_KV_SECRET_NAME_REGEX = /^[a-zA-Z0-9-]+$/

const sanitizeSecretName = (name: string) =>
  name.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-{2,}/g, '-')

export const CreateAzureKeyVaultSync = (props: { appId: string; closeModal: () => void }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { appId, closeModal } = props

  const { data } = useQuery(GetAppSyncStatus, { variables: { appId } })
  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: { appId },
  })
  const [getAzureKvSecrets, { loading }] = useLazyQuery(GetAzureKeyVaultSecrets, {
    fetchPolicy: 'network-only',
  })

  const [createAzureKvSync, { data: syncData, loading: creating }] =
    useMutation(CreateNewAzureKeyVaultSync)

  const [credential, setCredential] = useState<ProviderCredentialsType | null>(null)
  const [vaultUri, setVaultUri] = useState('')

  const [kvSecrets, setKvSecrets] = useState<AzureKeyVaultSecretType[]>([])

  const [syncMode, setSyncMode] = useState<'individual' | 'blob'>('individual')

  const [createNewSecret, setCreateNewSecret] = useState(true)
  const [newSecretName, setNewSecretName] = useState<string>('')
  const [secretNameIsCustom, setSecretNameIsCustom] = useState(false)
  const [kvSecret, setKvSecret] = useState<AzureKeyVaultSecretType | null>(null)

  const [phaseEnv, setPhaseEnv] = useState<EnvironmentType | null>(null)
  const [path, setPath] = useState('/')

  const [kvSecretQuery, setKvSecretQuery] = useState('')
  const [credentialsValid, setCredentialsValid] = useState(false)
  const [consentGiven, setConsentGiven] = useState(false)

  useEffect(() => {
    if (appEnvsData?.appEnvironments.length > 0) {
      const defaultEnv: EnvironmentType = appEnvsData.appEnvironments[0]
      setPhaseEnv(defaultEnv)
      setNewSecretName(
        sanitizeSecretName(`${defaultEnv.app.name}-${defaultEnv.name}`).toLowerCase()
      )
    }
  }, [appEnvsData])

  useEffect(() => {
    if (phaseEnv && !secretNameIsCustom)
      setNewSecretName(sanitizeSecretName(`${phaseEnv.app.name}-${phaseEnv.name}`).toLowerCase())
  }, [phaseEnv, secretNameIsCustom])

  const filteredKvSecrets =
    kvSecretQuery === ''
      ? kvSecrets
      : kvSecrets.filter((secret) =>
          secret.name?.toLowerCase().includes(kvSecretQuery.toLowerCase())
        )

  const handleUpdateSecretName = (secretName: string) => {
    setNewSecretName(secretName)
    setSecretNameIsCustom(true)
  }

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (credential === null) {
      toast.error('Please select credentials to use for this sync')
      return false
    }

    if (!vaultUri) {
      toast.error('Please enter a Vault URI')
      return false
    }

    if (!credentialsValid) {
      try {
        const { data: secretsData, error } = await getAzureKvSecrets({
          variables: {
            credentialId: credential.id,
            vaultUri,
          },
        })

        if (error || !secretsData) {
          toast.error('Failed to connect to Azure Key Vault. Check your credentials and Vault URI.')
          return false
        }

        setKvSecrets(secretsData.azureKvSecrets ?? [])
        setCredentialsValid(true)
      } catch {
        toast.error('Failed to connect to Azure Key Vault. Check your credentials and Vault URI.')
        return false
      }
    } else {
      if (syncMode === 'blob') {
        const secretName = createNewSecret ? newSecretName : kvSecret?.name
        if (!secretName) {
          toast.error('Please select or enter a secret name for blob mode')
          return false
        }

        if (createNewSecret && !AZ_KV_SECRET_NAME_REGEX.test(secretName)) {
          toast.error('Secret name can only contain alphanumeric characters and hyphens')
          return false
        }

        await createAzureKvSync({
          variables: {
            envId: phaseEnv?.id,
            path,
            credentialId: credential.id,
            vaultUri,
            syncMode: 'blob',
            secretName,
          },
          refetchQueries: [{ query: GetAppSyncStatus, variables: { appId } }],
        })
      } else {
        await createAzureKvSync({
          variables: {
            envId: phaseEnv?.id,
            path,
            credentialId: credential.id,
            vaultUri,
            syncMode: 'individual',
          },
          refetchQueries: [{ query: GetAppSyncStatus, variables: { appId } }],
        })
      }

      toast.success('Created new Sync!')
      closeModal()
    }
  }

  return (
    <div className="p-4 space-y-6">
      <div>
        <div className="text-2xl font-semibold flex items-center gap-2 text-black dark:text-white">
          <VscAzure className="text-[#0078D4]" />
          Azure Key Vault
        </div>
        <div className="text-neutral-500">Sync an environment with Azure Key Vault.</div>
      </div>
      <form onSubmit={handleSubmit}>
        {!credentialsValid && (
          <div className="space-y-4">
            <div className="font-medium text-black dark:text-white">
              Step 1: Choose authentication credentials
            </div>
            <div className="flex items-end gap-2 justify-between">
              <div className="w-full">
                <ProviderCredentialPicker
                  credential={credential}
                  setCredential={(cred) => setCredential(cred)}
                  orgId={organisation!.id}
                  providerFilter={'azure'}
                  setDefault={true}
                />
              </div>
            </div>
            <div>
              <Input
                value={vaultUri}
                setValue={setVaultUri}
                label="Vault URI"
                placeholder="https://myvault.vault.azure.net"
                required
              />
            </div>
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
              <div className="font-medium text-black dark:text-white">Secret Mapping</div>
              <div className="grid grid-cols-2 gap-4">
                <div
                  role="button"
                  onClick={() => setSyncMode('individual')}
                  className={clsx(
                    'flex items-center gap-2 py-1 px-2 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 border border-zinc-200 dark:border-zinc-800 rounded-full text-zinc-900 dark:text-zinc-100',
                    syncMode === 'individual' ? 'bg-zinc-200 dark:bg-zinc-700' : 'bg-zinc-100 dark:bg-zinc-800'
                  )}
                >
                  {syncMode === 'individual' ? (
                    <FaDotCircle className="text-emerald-500" />
                  ) : (
                    <FaCircle />
                  )}
                  Individual Secrets
                </div>

                <div
                  role="button"
                  onClick={() => setSyncMode('blob')}
                  className={clsx(
                    'flex items-center gap-2 py-1 px-2 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 border border-zinc-200 dark:border-zinc-800 rounded-full text-zinc-900 dark:text-zinc-100',
                    syncMode === 'blob' ? 'bg-zinc-200 dark:bg-zinc-700' : 'bg-zinc-100 dark:bg-zinc-800'
                  )}
                >
                  {syncMode === 'blob' ? (
                    <FaDotCircle className="text-emerald-500" />
                  ) : (
                    <FaCircle />
                  )}
                  JSON Blob
                </div>
              </div>

              {syncMode === 'individual' && (
                <div className="text-sm text-neutral-500">
                  Each Phase secret will be synced as a separate secret in Azure Key Vault.
                  Underscores (_) in secret names are replaced with hyphens (-).
                </div>
              )}

              {syncMode === 'blob' && (
                <div className="space-y-4">
                  <div className="text-sm text-neutral-500">
                    All Phase secrets will be synced as a single JSON blob to one Azure Key Vault
                    secret.
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div
                      role="button"
                      onClick={() => setCreateNewSecret(true)}
                      className={clsx(
                        'flex items-center gap-2 py-1 px-2 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 border border-zinc-200 dark:border-zinc-800 rounded-full text-zinc-900 dark:text-zinc-100',
                        createNewSecret ? 'bg-zinc-200 dark:bg-zinc-700' : 'bg-zinc-100 dark:bg-zinc-800'
                      )}
                    >
                      {createNewSecret ? (
                        <FaDotCircle className="text-emerald-500" />
                      ) : (
                        <FaCircle />
                      )}
                      Create new secret
                    </div>

                    <div
                      role="button"
                      onClick={() => setCreateNewSecret(false)}
                      className={clsx(
                        'flex items-center gap-2 py-1 px-2 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 border border-zinc-200 dark:border-zinc-800 rounded-full text-zinc-900 dark:text-zinc-100',
                        !createNewSecret ? 'bg-zinc-200 dark:bg-zinc-700' : 'bg-zinc-100 dark:bg-zinc-800'
                      )}
                    >
                      {!createNewSecret ? (
                        <FaDotCircle className="text-emerald-500" />
                      ) : (
                        <FaCircle />
                      )}
                      Overwrite existing secret
                    </div>
                  </div>

                  {createNewSecret ? (
                    <div className="space-y-2">
                      <Input
                        value={newSecretName}
                        setValue={handleUpdateSecretName}
                        label="New secret name"
                        required
                      />
                      {newSecretName && !AZ_KV_SECRET_NAME_REGEX.test(newSecretName) && (
                        <p className="text-red-500 text-xs">
                          Only alphanumeric characters and hyphens are allowed.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="relative">
                      <Combobox as="div" value={kvSecret} onChange={setKvSecret}>
                        {({ open }) => (
                          <>
                            <div className="space-y-2">
                              <Combobox.Label as={Fragment}>
                                <label className="block text-neutral-500 text-sm">
                                  Key Vault Secret
                                </label>
                              </Combobox.Label>
                              <div className="w-full relative flex items-center">
                                <Combobox.Input
                                  className="w-full"
                                  onChange={(event) => setKvSecretQuery(event.target.value)}
                                  required
                                  displayValue={(secret: AzureKeyVaultSecretType) =>
                                    secret?.name!
                                  }
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
                                  {filteredKvSecrets.length === 0 ? (
                                    <div className="p-2 text-sm text-neutral-500">
                                      No secrets found.
                                    </div>
                                  ) : (
                                    filteredKvSecrets.map((secret) => (
                                      <Combobox.Option
                                        as="div"
                                        key={secret.name}
                                        value={secret}
                                      >
                                        {({ active, selected }) => (
                                          <div
                                            className={clsx(
                                              'flex items-center gap-2 p-2 cursor-pointer rounded-md w-full',
                                              active && 'bg-zinc-400 dark:bg-zinc-700'
                                            )}
                                          >
                                            <FaKey className="shrink-0 text-neutral-500" />
                                            <div>
                                              <div className="font-semibold text-black dark:text-white">
                                                {secret.name}
                                              </div>
                                              <div className="text-neutral-500 text-2xs">
                                                {secret.updatedOn &&
                                                  `Updated ${new Date(secret.updatedOn).toLocaleDateString()}`}
                                                {secret.contentType &&
                                                  ` · ${secret.contentType}`}
                                              </div>
                                            </div>
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
            </div>
          </div>
        )}
        {credentialsValid && (
          <label className="flex items-center gap-2 pt-8 cursor-pointer text-sm text-neutral-500">
            <input
              type="checkbox"
              checked={consentGiven}
              onChange={(e) => setConsentGiven(e.target.checked)}
              className="accent-emerald-500"
            />
            <span>
              I understand that secrets in the destination that are not in Phase will be{' '}
              {syncMode === 'individual' ? 'disabled' : 'overwritten'}.
              <span className="text-red-500 ml-0.5">*</span>
            </span>
          </label>
        )}

        <div className="flex items-center justify-between pt-4">
          <div>
            {credentialsValid && (
              <Button variant="secondary" onClick={() => setCredentialsValid(false)}>
                Back
              </Button>
            )}
          </div>

          <Button
            isLoading={loading || creating}
            variant="primary"
            type="submit"
            disabled={credentialsValid && !consentGiven}
          >
            {credentialsValid ? 'Create' : 'Next'}
          </Button>
        </div>
      </form>
    </div>
  )
}
