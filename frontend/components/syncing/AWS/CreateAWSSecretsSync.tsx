import GetAwsSecrets from '@/graphql/queries/syncing/aws/getSecrets.gql'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import CreateNewAWSSecretsSync from '@/graphql/mutations/syncing/aws/CreateAwsSecretsSync.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { encryptAsymmetric } from '@/utils/crypto'
import { Fragment, useContext, useEffect, useState } from 'react'
import { Button } from '../../common/Button'
import {
  AwsSecretType,
  CloudFlarePagesType,
  EnvironmentType,
  ProviderCredentialsType,
} from '@/apollo/graphql'
import { Disclosure, Listbox, RadioGroup, Transition } from '@headlessui/react'
import clsx from 'clsx'
import {
  FaAngleDoubleDown,
  FaChevronDown,
  FaChevronRight,
  FaCircle,
  FaDotCircle,
  FaEye,
  FaEyeSlash,
  FaPlus,
} from 'react-icons/fa'
import { toast } from 'react-toastify'
import { SiAmazonaws, SiCloudflarepages } from 'react-icons/si'
import { AwsRegion, awsRegions } from '@/utils/syncing/aws'
import { ProviderCredentialPicker } from '../ProviderCredentialPicker'
import { organisationContext } from '@/contexts/organisationContext'
import { Input } from '@/components/common/Input'

export const CreateAWSSecretsSync = (props: { appId: string; closeModal: () => void }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { appId, closeModal } = props

  const { data } = useQuery(GetAppSyncStatus, { variables: { appId } })
  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId,
    },
  })
  const [getAwsSecrets, { loading }] = useLazyQuery(GetAwsSecrets)

  const [createAwsSecretSync, { data: syncData, loading: creating }] =
    useMutation(CreateNewAWSSecretsSync)

  const [credential, setCredential] = useState<ProviderCredentialsType | null>(null)

  const [awsSecrets, setAwsSecrets] = useState<AwsSecretType[]>([])

  const [createNewSecret, setCreateNewSecret] = useState(true)

  const [newAwsSecretName, setNewAwsSecretName] = useState<string>('')
  const [secretNameIsCustom, setSecretNameIsCustom] = useState(false)

  const [kmsKeyId, setKmsKeyId] = useState<string>('')

  const [awsSecret, setCfProject] = useState<AwsSecretType | null>(null)

  const [phaseEnv, setPhaseEnv] = useState<EnvironmentType | null>(null)

  const [credentialsValid, setCredentialsValid] = useState(false)

  useEffect(() => {
    if (appEnvsData?.appEnvironments.length > 0) {
      const defaultEnv: EnvironmentType = appEnvsData.appEnvironments[0]
      setPhaseEnv(defaultEnv)
      setNewAwsSecretName(
        `${defaultEnv.app.name.replace(/ /g, '-')}/${defaultEnv.name}`.toLowerCase()
      )
    }
  }, [appEnvsData])

  useEffect(() => {
    if (phaseEnv && !secretNameIsCustom)
      setNewAwsSecretName(`${phaseEnv.app.name.replace(/ /g, '-')}/${phaseEnv.name}`.toLowerCase())
  }, [phaseEnv, secretNameIsCustom])

  const handleUpdateSecretName = (secretName: string) => {
    setNewAwsSecretName(secretName)
    setSecretNameIsCustom(true)
  }

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (credential === null) {
      toast.error('Please select credentials to use for this sync')
      return false
    }

    if (!credentialsValid) {
      const { data: secretsData } = await getAwsSecrets({
        variables: {
          credentialId: credential.id,
        },
      })

      if (secretsData.awsSecrets) setAwsSecrets(secretsData.awsSecrets)
      setCredentialsValid(true)
    } else if (!createNewSecret && awsSecret === null) {
      toast.error('Please select an AWS Secret to use for this sync!')
      return false
    } else {
      await createAwsSecretSync({
        variables: {
          envId: phaseEnv?.id,
          credentialId: credential.id,
          secretName: createNewSecret ? newAwsSecretName : awsSecret!.name,
          kmsId: kmsKeyId || null,
        },
        refetchQueries: [{ query: GetAppSyncStatus, variables: { appId } }],
      })

      toast.success('Created new Sync!')
      closeModal()
    }
  }

  return (
    <div className="p-4 space-y-6">
      <div>
        <div className="text-2xl font-semibold flex items-center gap-2">
          <SiAmazonaws />
          AWS Secrets Manager
        </div>
        <div className="text-neutral-500">Sync an environment with AWS Secrets Manager.</div>
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
                  providerFilter={'aws'}
                />
              </div>
            </div>
          </div>
        )}

        {credentialsValid && (
          <div className="space-y-6">
            <div>
              <RadioGroup value={phaseEnv} onChange={setPhaseEnv}>
                <RadioGroup.Label as={Fragment}>
                  <label className="block text-gray-700 text-sm font-bold mb-2">
                    Phase Environment
                  </label>
                </RadioGroup.Label>
                <div className="flex flex-wrap items-center gap-2">
                  {appEnvsData.appEnvironments.map((env: EnvironmentType) => (
                    <RadioGroup.Option key={env.id} value={env} as={Fragment}>
                      {({ active, checked }) => (
                        <div
                          className={clsx(
                            'flex items-center gap-2 py-1 px-2 cursor-pointer bg-zinc-800 border border-zinc-800 rounded-full capitalize',
                            active && 'border-zinc-700',
                            checked && 'bg-zinc-700'
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
            </div>

            <div className="flex justify-between items-center gap-4 py-8">
              <div className="border-b border-neutral-500/40 w-full"></div>
              <FaAngleDoubleDown className="shrink-0 text-neutral-500 text-2xl" />
              <div className="border-b border-neutral-500/40 w-full"></div>
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div
                role="button"
                onClick={() => setCreateNewSecret(true)}
                className={clsx(
                  'flex items-center gap-2 py-1 px-2 cursor-pointer  hover:border-zinc-700 border border-zinc-800  rounded-full',

                  createNewSecret ? 'bg-zinc-700' : 'bg-zinc-800'
                )}
              >
                {createNewSecret ? <FaDotCircle className="text-emerald-500" /> : <FaCircle />}
                Create new AWS Secret
              </div>

              <div
                role="button"
                onClick={() => setCreateNewSecret(false)}
                className={clsx(
                  'flex items-center gap-2 py-1 px-2 cursor-pointer  hover:border-zinc-700 border border-zinc-800  rounded-full',

                  !createNewSecret ? 'bg-zinc-700' : 'bg-zinc-800'
                )}
              >
                {!createNewSecret ? <FaDotCircle className="text-emerald-500" /> : <FaCircle />}
                Use existing AWS Secret
              </div>

              {createNewSecret ? (
                <div className={clsx('space-y-2 col-span-2', !createNewSecret && 'opacity-60')}>
                  <Input
                    value={newAwsSecretName}
                    setValue={handleUpdateSecretName}
                    label={'New AWS Secret name'}
                    disabled={!createNewSecret}
                    required={createNewSecret}
                  />
                </div>
              ) : (
                <div className={clsx('space-y-2 col-span-2', createNewSecret && 'opacity-60')}>
                  <label className="block text-gray-700 text-sm font-bold mb-2">
                    AWS Secret{!createNewSecret && <span className="text-red-500 ml-1">*</span>}
                  </label>
                  <div className="relative">
                    <Listbox value={awsSecret} onChange={setCfProject}>
                      {({ open }) => (
                        <>
                          <Listbox.Button as={Fragment} aria-disabled={createNewSecret}>
                            <div
                              className={clsx(
                                'p-2 flex items-center justify-between rounded-md h-10 gap-2 font-semibold',
                                createNewSecret ? 'cursor-not-allowed' : 'cursor-pointer'
                              )}
                            >
                              {awsSecret?.name || 'Select a Secret'}

                              <FaChevronDown
                                className={clsx(
                                  'transition-transform ease duration-300 text-neutral-500',
                                  open ? 'rotate-180' : 'rotate-0'
                                )}
                              />
                            </div>
                          </Listbox.Button>
                          <Listbox.Options>
                            <div className="bg-zinc-300 dark:bg-zinc-800 p-2 rounded-md shadow-2xl absolute z-10 w-full max-h-80 overflow-y-auto">
                              {awsSecrets.map((secret) => (
                                <Listbox.Option key={secret.arn} value={secret} as={Fragment}>
                                  {({ active, selected }) => (
                                    <div
                                      className={clsx(
                                        'flex flex-col p-2 cursor-pointer rounded-md w-full',
                                        active && 'bg-zinc-400 dark:bg-zinc-700'
                                      )}
                                    >
                                      <div className="font-semibold text-black dark:text-white">
                                        {secret.name}
                                      </div>
                                      <div className="text-neutral-500 text-xs">{secret.arn}</div>
                                    </div>
                                  )}
                                </Listbox.Option>
                              ))}
                            </div>
                          </Listbox.Options>
                        </>
                      )}
                    </Listbox>
                  </div>
                </div>
              )}

              <div className="col-span-2">
                <Disclosure
                  as="div"
                  className="ring-1 ring-inset ring-neutral-500/40 rounded-md p-px flex flex-col divide-y divide-neutral-500/30 w-full"
                >
                  {({ open }) => (
                    <>
                      <Disclosure.Button>
                        <div
                          className={clsx(
                            'p-2 flex justify-between items-center gap-8 transition ease w-full',
                            open
                              ? 'bg-zinc-200 dark:bg-zinc-800 rounded-t-md'
                              : 'bg-zinc-300 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 rounded-md'
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <FaPlus />
                            <div className="font-semibold text-black dark:text-white">Advanced</div>
                          </div>
                          <FaChevronRight
                            className={clsx(
                              'transform transition ease text-neutral-500',
                              open ? 'rotate-90' : 'rotate-0'
                            )}
                          />
                        </div>
                      </Disclosure.Button>

                      <Transition
                        enter="transition duration-100 ease-out"
                        enterFrom="transform scale-95 opacity-0"
                        enterTo="transform scale-100 opacity-100"
                        leave="transition duration-75 ease-out"
                        leaveFrom="transform scale-100 opacity-100"
                        leaveTo="transform scale-95 opacity-0"
                      >
                        <Disclosure.Panel>
                          <div className="p-4">
                            <div className="space-y-8 ">
                              <div>
                                <h3 className="text-black dark:text-white font-semibold">
                                  Customer managed key
                                </h3>
                                <div className="text-neutral-500 text-sm">
                                  Encrypt secrets with AWS KMS CMK (Customer Managed Key)
                                </div>
                              </div>

                              <Input
                                value={kmsKeyId}
                                setValue={setKmsKeyId}
                                label={'KMS Key ARN (Optional)'}
                                required={false}
                              />
                            </div>
                          </div>
                        </Disclosure.Panel>
                      </Transition>
                    </>
                  )}
                </Disclosure>
              </div>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between pt-8">
          <div>
            {credentialsValid && (
              <Button variant="secondary" onClick={() => setCredentialsValid(false)}>
                Back
              </Button>
            )}
          </div>

          <Button isLoading={loading || creating} variant="primary" type="submit">
            {credentialsValid ? 'Create' : 'Next'}
          </Button>
        </div>
      </form>
    </div>
  )
}
