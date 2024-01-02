import GetAwsSecrets from '@/graphql/queries/syncing/aws/getSecrets.gql'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import CreateNewAWSSecretsSync from '@/graphql/mutations/syncing/aws/CreateAwsSecretsSync.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { encryptAsymmetric } from '@/utils/crypto'
import { Fragment, useEffect, useState } from 'react'
import { Button } from '../../common/Button'
import { CloudFlarePagesType, EnvironmentType } from '@/apollo/graphql'
import { Listbox, RadioGroup } from '@headlessui/react'
import clsx from 'clsx'
import {
  FaAngleDoubleDown,
  FaChevronDown,
  FaCircle,
  FaDotCircle,
  FaEye,
  FaEyeSlash,
} from 'react-icons/fa'
import { toast } from 'react-toastify'
import { SiAmazonaws, SiCloudflarepages } from 'react-icons/si'
import { AwsRegion, awsRegions } from '@/utils/syncing/aws'

export const CreateAWSSecretsSync = (props: { appId: string; onComplete?: Function }) => {
  const { appId } = props

  const { data } = useQuery(GetAppSyncStatus, { variables: { appId } })
  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId,
    },
  })
  const [getAwsSecrets, { data: pagesData, loading }] = useLazyQuery(GetAwsSecrets)

  const [createAwsSecretSync, { data: syncData, loading: creating }] =
    useMutation(CreateNewAWSSecretsSync)

  const [accessKeyId, setAccessKeyId] = useState('')
  const [showAccessKeyId, setShowAccessKeyId] = useState(false)

  const [secretAccessKey, setSecretAccessKey] = useState('')
  const [showSecretAccessKey, setShowSecretAccessKey] = useState(false)

  const [region, setRegion] = useState<AwsRegion>(awsRegions[0])

  const [cfProject, setCfProject] = useState<CloudFlarePagesType | null>(null)
  const [cfEnv, setCfEnv] = useState<'preview' | 'production'>('preview')
  const [phaseEnv, setPhaseEnv] = useState<EnvironmentType | null>(null)

  const [credentialsValid, setCredentialsValid] = useState(false)

  useEffect(() => {
    if (pagesData?.cloudflarePagesProjects) {
      setCredentialsValid(true)
    }
  }, [pagesData])

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    // const encryptedAccountId = await encryptAsymmetric(accessKeyId, data.serverPublicKey)
    // const encryptedAccessToken = await encryptAsymmetric(accessToken, data.serverPublicKey)

    // if (!credentialsValid) {
    //   await getAwsSecrets({
    //     variables: {
    //       accountId: encryptedAccountId,
    //       accessToken: encryptedAccessToken,
    //     },
    //   })
    // } else {
    //   await createAwsSecretSync({
    //     variables: {
    //       envId: phaseEnv?.id,
    //       projectName: cfProject?.name,
    //       deploymentId: cfProject?.deploymentId,
    //       projectEnv: cfEnv,
    //       accessToken: encryptedAccessToken,
    //       accountId: encryptedAccountId,
    //     },
    //     refetchQueries: [{ query: GetAppSyncStatus, variables: { appId } }],
    //   })

    //   toast.success('Created new Sync!')
    //   //props.onComplete()
    // }
  }

  const cfProjects: CloudFlarePagesType[] = pagesData?.cloudflarePagesProjects ?? []

  const cfEnvOptions = ['preview', 'production']

  return (
    <div className="p-4 space-y-6">
      <div>
        <div className="text-2xl font-semibold flex items-center gap-1">
          <SiAmazonaws />
          AWS Secrets Manager
        </div>
        <div className="text-neutral-500">Sync an environment with AWS Secrets Manager.</div>
      </div>
      <form onSubmit={handleSubmit}>
        {!credentialsValid && (
          <div className="space-y-4">
            <div className="space-y-2 w-full">
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="accountId">
                Access Key ID
              </label>
              <div className="flex justify-between w-full bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40  focus-within:ring-1 focus-within:ring-inset focus-within:ring-emerald-500 rounded-md p-px">
                <input
                  id="accessKeyId"
                  type={showAccessKeyId ? 'text' : 'password'}
                  value={accessKeyId}
                  onChange={(e) => setAccessKeyId(e.target.value)}
                  required
                  autoFocus
                  className="custom w-full text-zinc-800 font-mono dark:text-white bg-zinc-100 dark:bg-zinc-800 rounded-md ph-no-capture"
                />
                <button
                  className="bg-zinc-100 dark:bg-zinc-800 px-4 text-neutral-500 rounded-md"
                  type="button"
                  onClick={() => setShowAccessKeyId(!showAccessKeyId)}
                  tabIndex={-1}
                >
                  {secretAccessKey ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
            </div>

            <div className="space-y-2 w-full">
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="token">
                Secret Access Key
              </label>
              <div className="flex justify-between w-full bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40  focus-within:ring-1 focus-within:ring-inset focus-within:ring-emerald-500 rounded-md p-px">
                <input
                  id="secretAccessKey"
                  type={showSecretAccessKey ? 'text' : 'password'}
                  value={secretAccessKey}
                  onChange={(e) => setSecretAccessKey(e.target.value)}
                  required
                  className="custom w-full text-zinc-800 font-mono dark:text-white bg-zinc-100 dark:bg-zinc-800 rounded-md ph-no-capture"
                />
                <button
                  className="bg-zinc-100 dark:bg-zinc-800 px-4 text-neutral-500 rounded-md"
                  type="button"
                  onClick={() => setShowSecretAccessKey(!showSecretAccessKey)}
                  tabIndex={-1}
                >
                  {showSecretAccessKey ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="block text-gray-700 text-sm font-bold mb-2">AWS Region</label>
              <div className="relative">
                <Listbox value={region} onChange={setRegion}>
                  {({ open }) => (
                    <>
                      <Listbox.Button as={Fragment} aria-required>
                        <div
                          className={clsx(
                            'p-2 flex items-center justify-between cursor-pointer gap-2 bg-zinc-100 dark:bg-zinc-800 dark:bg-opacity-60 rounded-md text-zinc-800 dark:text-white ring-1 ring-inset ring-neutral-500/40 focus:ring-1 focus:ring-emerald-500 group-focus-within:invalid:ring-red-500 focus:ring-inset'
                          )}
                        >
                          <div>
                            <div className="font-semibold text-sm text-black dark:text-white">
                              {region.regionName}
                            </div>
                            <div className="text-neutral-500 text-xs">{region.region}</div>
                          </div>

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
                          {awsRegions.map((region) => (
                            <Listbox.Option key={region.region} value={region} as={Fragment}>
                              {({ active, selected }) => (
                                <div
                                  className={clsx(
                                    'space-y-0 p-2 cursor-pointer rounded-md w-full',
                                    active && 'bg-zinc-400 dark:bg-zinc-700'
                                  )}
                                >
                                  <div className="font-semibold text-sm text-black dark:text-white">
                                    {region.regionName}
                                  </div>
                                  <div className="text-neutral-500 text-xs">{region.region}</div>
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

            <div className="flex justify-between items-center gap-4">
              <div className="border-b border-neutral-500/40 w-full"></div>
              <FaAngleDoubleDown className="shrink-0 text-neutral-500 text-2xl" />
              <div className="border-b border-neutral-500/40 w-full"></div>
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-2">
                <label className="block text-gray-700 text-sm font-bold mb-2">
                  Cloudflare Project
                </label>
                <div className="relative">
                  <Listbox value={cfProject} onChange={setCfProject}>
                    {({ open }) => (
                      <>
                        <Listbox.Button as={Fragment} aria-required>
                          <div
                            className={clsx(
                              'p-2 flex items-center justify-between cursor-pointer rounded-md h-10 gap-2'
                            )}
                          >
                            {cfProject?.name || 'Select a project'}

                            <FaChevronDown
                              className={clsx(
                                'transition-transform ease duration-300 text-neutral-500',
                                open ? 'rotate-180' : 'rotate-0'
                              )}
                            />
                          </div>
                        </Listbox.Button>
                        <Listbox.Options>
                          <div className="bg-zinc-300 dark:bg-zinc-800 p-2 rounded-md shadow-2xl absolute z-10 w-full">
                            {cfProjects.map((project) => (
                              <Listbox.Option
                                key={project.deploymentId}
                                value={project}
                                as={Fragment}
                              >
                                {({ active, selected }) => (
                                  <div
                                    className={clsx(
                                      'flex flex-col gap-1 p-2 cursor-pointer rounded-md w-full',
                                      active && 'bg-zinc-400 dark:bg-zinc-700'
                                    )}
                                  >
                                    <div className="font-semibold text-black dark:text-white">
                                      {project.name}
                                    </div>
                                    <div className="text-neutral-500 text-2xs">
                                      {project.deploymentId}
                                    </div>
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

              <div>
                <RadioGroup value={cfEnv} onChange={setCfEnv}>
                  <RadioGroup.Label as={Fragment}>
                    <label className="block text-gray-700 text-sm font-bold mb-2">
                      Cloudflare Project Environment
                    </label>
                  </RadioGroup.Label>
                  <div className="flex flex-wrap items-center gap-2">
                    {cfEnvOptions.map((option) => (
                      <RadioGroup.Option key={option} value={option} as={Fragment}>
                        {({ active, checked }) => (
                          <div
                            className={clsx(
                              'flex items-center gap-2 py-1 px-2 cursor-pointer bg-zinc-800 border border-zinc-800 rounded-full capitalize',
                              active && 'border-zinc-700',
                              checked && 'bg-zinc-700'
                            )}
                          >
                            {checked ? <FaDotCircle className="text-emerald-500" /> : <FaCircle />}
                            {option}
                          </div>
                        )}
                      </RadioGroup.Option>
                    ))}
                  </div>
                </RadioGroup>
              </div>
            </div>
          </div>
        )}
        <div className="flex items-center justify-end pt-8">
          <Button isLoading={loading || creating} variant="primary" type="submit">
            Next
          </Button>
        </div>
      </form>
    </div>
  )
}
