import GetCfPages from '@/graphql/queries/syncing/cloudflare/getPages.gql'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import CreateNewCfPagesSync from '@/graphql/mutations/syncing/cloudflare/CreateCfPagesSync.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useState } from 'react'
import { Button } from '../../common/Button'
import { CloudFlarePagesType, EnvironmentType, ProviderCredentialsType } from '@/apollo/graphql'
import { Combobox, RadioGroup, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { FaAngleDoubleDown, FaChevronDown, FaCircle, FaDotCircle } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { SiCloudflarepages } from 'react-icons/si'
import { organisationContext } from '@/contexts/organisationContext'
import { ProviderCredentialPicker } from '../ProviderCredentialPicker'

export const CreateCloudflarePagesSync = (props: { appId: string; closeModal: () => void }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { appId, closeModal } = props

  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId,
    },
  })
  const { data: credentialsData } = useQuery(GetSavedCredentials, {
    variables: { orgId: organisation!.id },
  })

  const [getCloudflarePages, { loading }] = useLazyQuery(GetCfPages)

  const [createCfPagesSync, { data: syncData, loading: creating }] =
    useMutation(CreateNewCfPagesSync)

  const [credential, setCredential] = useState<ProviderCredentialsType | null>(null)

  const [cfProjects, setCfProjects] = useState<CloudFlarePagesType[]>([])

  const [cfProject, setCfProject] = useState<CloudFlarePagesType | null>(null)
  const [query, setQuery] = useState('')
  const [cfEnv, setCfEnv] = useState<'preview' | 'production'>('preview')
  const [phaseEnv, setPhaseEnv] = useState<EnvironmentType | null>(null)

  const [credentialsValid, setCredentialsValid] = useState(false)

  // useEffect(() => {
  //   if (pagesData?.cloudflarePagesProjects) {
  //     setCredentialsValid(true)
  //   }
  // }, [pagesData])

  useEffect(() => {
    if (credentialsData && credentialsData.savedCredentials.length > 0) {
      setCredential(credentialsData.savedCredentials[0])
    }
  }, [credentialsData])

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (credential === null) {
      toast.error('Please select credential to use for this sync')
      return false
    } else if (!credentialsValid) {
      const { data: pagesData } = await getCloudflarePages({
        variables: {
          credentialId: credential.id,
        },
      })
      if (pagesData?.cloudflarePagesProjects) {
        setCfProjects(pagesData?.cloudflarePagesProjects)
        setCredentialsValid(true)
      }
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
      closeModal()
    }
  }

  const handleClearSelectedCredentials = () => {
    setCredentialsValid(false)
  }

  //const cfProjects: CloudFlarePagesType[] = pagesData?.cloudflarePagesProjects ?? []

  const filteredProjects =
    query === ''
      ? cfProjects
      : cfProjects.filter((project) => project.name?.toLowerCase().includes(query.toLowerCase()))

  const cfEnvOptions = ['preview', 'production']

  return (
    <div className="p-4 space-y-6">
      <div>
        <div className="text-2xl font-semibold text-black dark:text-white flex items-center gap-1">
          <SiCloudflarepages />
          Cloudflare Pages
        </div>
        <div className="text-neutral-500 text-sm">Sync an environment with Cloudflare pages.</div>
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
                />
              </div>
            </div>
          </div>
        )}

        {credentialsValid && (
          <div className="space-y-6">
            <div className="font-medium text-black dark:text-white">
              Step 2: Select source and destination for Secrets
            </div>
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
              <div className="relative">
                <Combobox value={cfProject} onChange={setCfProject}>
                  {({ open }) => (
                    <>
                      <div className="space-y-2">
                        <Combobox.Label as={Fragment}>
                          <label className="block text-gray-700 text-sm font-bold" htmlFor="name">
                            Cloudflare Project
                          </label>
                        </Combobox.Label>
                        <div className="w-full relative flex items-center">
                          <Combobox.Input
                            className="w-full"
                            onChange={(event) => setQuery(event.target.value)}
                            required
                            displayValue={(project: CloudFlarePagesType) => project?.name!}
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
                          <div className="bg-zinc-300 dark:bg-zinc-800 p-2 rounded-md shadow-2xl z-20 absolute max-h-80 overflow-y-auto">
                            {filteredProjects.map((project: CloudFlarePagesType) => (
                              <Combobox.Option key={project.deploymentId} value={project}>
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
                              </Combobox.Option>
                            ))}
                          </div>
                        </Combobox.Options>
                      </Transition>
                    </>
                  )}
                </Combobox>
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
