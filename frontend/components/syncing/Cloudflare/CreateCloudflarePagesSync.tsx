import GetCfPages from '@/graphql/queries/syncing/cloudflare/getPages.gql'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import SaveNewProviderCreds from '@/graphql/mutations/syncing/saveNewProviderCreds.gql'
import CreateNewCfPagesSync from '@/graphql/mutations/syncing/cloudflare/CreateCfPagesSync.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { encryptAsymmetric } from '@/utils/crypto'
import { Fragment, useContext, useEffect, useState } from 'react'
import { Button } from '../../common/Button'
import { CloudFlarePagesType, EnvironmentType, ProviderCredentialsType } from '@/apollo/graphql'
import { Listbox, RadioGroup } from '@headlessui/react'
import clsx from 'clsx'
import { FaAngleDoubleDown, FaChevronDown, FaCircle, FaDotCircle, FaKey } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { SiCloudflarepages } from 'react-icons/si'
import { organisationContext } from '@/contexts/organisationContext'
import { CreateProviderCredentialsDialog } from '../CreateProviderCredentialsDialog'
import { ProviderCredentialPicker } from '../ProviderCredentialPicker'

export const CreateCloudflarePagesSync = (props: { appId: string; onComplete?: Function }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { appId } = props

  const { data } = useQuery(GetAppSyncStatus, { variables: { appId } })
  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId,
    },
  })
  const { data: credentialsData } = useQuery(GetSavedCredentials, {
    variables: { orgId: organisation!.id },
  })

  const [getCloudflarePages, { data: pagesData, loading }] = useLazyQuery(GetCfPages)

  const [createCfPagesSync, { data: syncData, loading: creating }] =
    useMutation(CreateNewCfPagesSync)

  const [createNewCred] = useMutation(SaveNewProviderCreds)

  const [accountId, setAccountId] = useState('')
  const [showAccountId, setShowAccountId] = useState(false)

  const [accessToken, setAccessToken] = useState('')
  const [showAccessToken, setShowAccessToken] = useState(false)

  const [credential, setCredential] = useState<ProviderCredentialsType | null>(null)

  const [cfProject, setCfProject] = useState<CloudFlarePagesType | null>(null)
  const [cfEnv, setCfEnv] = useState<'preview' | 'production'>('preview')
  const [phaseEnv, setPhaseEnv] = useState<EnvironmentType | null>(null)

  const [credentialsValid, setCredentialsValid] = useState(false)

  useEffect(() => {
    if (pagesData?.cloudflarePagesProjects) {
      setCredentialsValid(true)
    }
  }, [pagesData])

  const credentials: ProviderCredentialsType[] =
    credentialsData?.savedCredentials.filter(
      (credential: ProviderCredentialsType) => credential.provider!.id === 'cloudflare'
    ) ?? []

  useEffect(() => {
    if (credentialsData && credentialsData.savedCredentials.length > 0) {
      setCredential(credentialsData.savedCredentials[0])
    }
  }, [credentialsData])

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    // const encryptedAccountId = await encryptAsymmetric(accountId, data.serverPublicKey)
    // const encryptedAccessToken = await encryptAsymmetric(accessToken, data.serverPublicKey)

    if (credential === null) {
      toast.error('Please select credential to use for this sync')
      return false
    } else if (!credentialsValid) {
      await getCloudflarePages({
        variables: {
          credentialId: credential.id,
        },
      })
    } else {
      await createCfPagesSync({
        variables: {
          envId: phaseEnv?.id,
          projectName: cfProject?.name,
          deploymentId: cfProject?.deploymentId,
          projectEnv: cfEnv,
          credentialId: credential.id,
        },
        refetchQueries: [{ query: GetAppSyncStatus, variables: { appId } }],
      })

      toast.success('Created new Sync!')
      //props.onComplete()
    }
  }

  const cfProjects: CloudFlarePagesType[] = pagesData?.cloudflarePagesProjects ?? []

  const cfEnvOptions = ['preview', 'production']

  return (
    <div className="p-4 space-y-6">
      <div>
        <div className="text-2xl font-semibold flex items-center gap-1">
          <SiCloudflarepages />
          Cloudflare Pages
        </div>
        <div className="text-neutral-500">Sync an environment with Cloudflare pages.</div>
      </div>

      {/* {!credentialsValid && (
        <div className="flex justify-end">
          <CreateProviderCredentialsDialog />
        </div>
      )} */}

      <form onSubmit={handleSubmit}>
        {!credentialsValid && (
          <>
            <ProviderCredentialPicker
              credential={credential}
              setCredential={(cred) => setCredential(cred)}
              orgId={organisation!.id}
            />
            {/* <Listbox value={credential} onChange={setCredential}>
              {({ open }) => (
                <>
                  <label className="block text-gray-700 text-sm font-bold mb-2">Credentials</label>
                  <Listbox.Button as={Fragment} aria-required>
                    <div className={clsx('p-2 flex items-center justify-between  rounded-md h-10')}>
                      {credential?.name || 'Select credentials'}
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
                      {credentials.map((cred: ProviderCredentialsType) => (
                        <Listbox.Option key={cred.id} value={cred} as={Fragment}>
                          {({ active, selected }) => (
                            <div
                              className={clsx(
                                'flex items-center gap-2 p-2 cursor-pointer rounded-full',
                                active && 'bg-zinc-400 dark:bg-zinc-700'
                              )}
                            >
                              <FaKey className="shrink-0" />
                              <div className="flex flex-col gap-2">
                                <span className="text-black dark:text-white font-semibold">
                                  {cred.name}
                                </span>
                              </div>
                            </div>
                          )}
                        </Listbox.Option>
                      ))}
                    </div>
                  </Listbox.Options>
                </>
              )}
            </Listbox> */}
          </>
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
