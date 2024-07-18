import GetRailwayProjects from '@/graphql/queries/syncing/railway/getProjects.gql'

import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import CreateNewRailwaySync from '@/graphql/mutations/syncing/railway/createRailwayEnvironmentSync.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useState } from 'react'
import { Button } from '../../common/Button'
import {
  EnvironmentType,
  ProviderCredentialsType,
  RailwayEnvironmentType,
  RailwayProjectType,
  RailwayServiceType,
} from '@/apollo/graphql'
import { Combobox, RadioGroup, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { FaAngleDoubleDown, FaChevronDown, FaCircle, FaDotCircle } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { SiRailway } from 'react-icons/si'
import { organisationContext } from '@/contexts/organisationContext'
import { ProviderCredentialPicker } from '../ProviderCredentialPicker'
import { Input } from '@/components/common/Input'

export const CreateRailwaySync = (props: { appId: string; closeModal: () => void }) => {
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

  const [getRailwayProjects, { loading }] = useLazyQuery(GetRailwayProjects)

  const [createRailwaySync, { data: syncData, loading: creating }] =
    useMutation(CreateNewRailwaySync)

  const [credential, setCredential] = useState<ProviderCredentialsType | null>(null)

  const [railwayProjects, setRailwayProjects] = useState<RailwayProjectType[]>([])
  const [railwayProject, setRailwayProject] = useState<RailwayProjectType | null>(null)
  const [railwayEnvironment, setRailwayEnvironment] = useState<RailwayEnvironmentType | null>(null)
  const [railwayService, setRailwayService] = useState<RailwayServiceType | null>(null)

  const [projectQuery, setProjectQuery] = useState('')
  const [serviceQuery, setServiceQuery] = useState('')

  const [phaseEnv, setPhaseEnv] = useState<EnvironmentType | null>(null)
  const [path, setPath] = useState('/')

  const [credentialsValid, setCredentialsValid] = useState(false)

  useEffect(() => {
    if (credentialsData && credentialsData.savedCredentials.length > 0) {
      setCredential(credentialsData.savedCredentials[0])
    }
  }, [credentialsData])

  // Preselect the first available env
  useEffect(() => {
    if (appEnvsData?.appEnvironments.length > 0) {
      const defaultEnv: EnvironmentType = appEnvsData.appEnvironments[0]
      setPhaseEnv(defaultEnv)
    }
  }, [appEnvsData])

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (credential === null) {
      toast.error('Please select credential to use for this sync')
      return false
    } else if (!credentialsValid) {
      const { data: projectsData } = await getRailwayProjects({
        variables: {
          credentialId: credential.id,
        },
      })
      if (projectsData?.railwayProjects) {
        setRailwayProjects(projectsData?.railwayProjects)
        setCredentialsValid(true)
      }
    } else if (!railwayProject || !railwayEnvironment) {
      toast.error('Please select a Railway Project and Environment!')
      return false
    } else {
      await createRailwaySync({
        variables: {
          envId: phaseEnv?.id,
          path,
          railwayProject: { id: railwayProject?.id, name: railwayProject?.name },
          railwayEnvironment: { id: railwayEnvironment?.id, name: railwayEnvironment?.name },
          railwayService: railwayService
            ? { id: railwayService.id, name: railwayService.name }
            : null,
          credentialId: credential.id,
        },
        refetchQueries: [{ query: GetAppSyncStatus, variables: { appId } }],
      })

      toast.success('Created new Sync!')
      closeModal()
    }
  }

  const filteredProjects =
    projectQuery === ''
      ? railwayProjects
      : railwayProjects.filter((project) =>
          project.name?.toLowerCase().includes(projectQuery.toLowerCase())
        )

  const filteredServices = railwayProject
    ? serviceQuery === ''
      ? railwayProject.services
      : railwayProject.services.filter((service) =>
          service.name?.toLowerCase().includes(serviceQuery.toLowerCase())
        )
    : []

  return (
    <div className="p-4 space-y-6">
      <div>
        <div className="text-2xl font-semibold text-black dark:text-white flex items-center gap-1">
          <SiRailway />
          Railway
        </div>
        <div className="text-neutral-500 text-sm">Sync an environment with Railway.</div>
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
                  providerFilter={'railway'}
                  setDefault={true}
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
            <div className="space-y-4">
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

              <Input value={path} setValue={setPath} label="Path" />
            </div>

            <div className="flex justify-between items-center gap-4 py-8">
              <div className="border-b border-neutral-500/40 w-full"></div>
              <FaAngleDoubleDown className="shrink-0 text-neutral-500 text-2xl" />
              <div className="border-b border-neutral-500/40 w-full"></div>
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div className="relative col-span-2">
                <Combobox value={railwayProject} onChange={setRailwayProject}>
                  {({ open }) => (
                    <>
                      <div className="space-y-2">
                        <Combobox.Label as={Fragment}>
                          <label className="block text-gray-700 text-sm font-bold" htmlFor="name">
                            Railway Project <span className="text-red-500">*</span>
                          </label>
                        </Combobox.Label>
                        <div className="w-full relative flex items-center">
                          <Combobox.Input
                            className="w-full"
                            onChange={(event) => setProjectQuery(event.target.value)}
                            required
                            displayValue={(project: RailwayProjectType) => project?.name!}
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
                          <div className="bg-zinc-300 dark:bg-zinc-800 p-2 rounded-md shadow-2xl z-20 absolute max-h-80 overflow-y-auto w-full">
                            {filteredProjects.map((project: RailwayProjectType) => (
                              <Combobox.Option key={project.id} value={project}>
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
                                    <div className="text-neutral-500 text-2xs">{project.id}</div>
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
              {railwayProject && (
                <div>
                  <RadioGroup
                    name="railwayEnvironment"
                    value={railwayEnvironment}
                    onChange={setRailwayEnvironment}
                  >
                    <RadioGroup.Label as={Fragment}>
                      <label className="block text-gray-700 text-sm font-bold mb-2">
                        Project Environment <span className="text-red-500">*</span>
                      </label>
                    </RadioGroup.Label>
                    <div className="flex flex-wrap items-center gap-2">
                      {railwayProject.environments!.map((env: RailwayEnvironmentType) => (
                        <RadioGroup.Option key={env.id} value={env} as={Fragment}>
                          {({ active, checked }) => (
                            <div
                              className={clsx(
                                'flex items-center gap-2 py-1 px-2 cursor-pointer bg-zinc-800 border border-zinc-800 rounded-full capitalize',
                                active && 'border-zinc-700',
                                checked && 'bg-zinc-700'
                              )}
                            >
                              {checked ? (
                                <FaDotCircle className="text-emerald-500" />
                              ) : (
                                <FaCircle />
                              )}
                              {env.name}
                            </div>
                          )}
                        </RadioGroup.Option>
                      ))}
                    </div>
                  </RadioGroup>
                </div>
              )}

              {railwayProject && (
                <div className="relative">
                  <Combobox value={railwayService} onChange={setRailwayService}>
                    {({ open }) => (
                      <>
                        <div className="space-y-2">
                          <Combobox.Label as={Fragment}>
                            <label className="block text-gray-700 text-sm font-bold" htmlFor="name">
                              Railway Service (Optional)
                            </label>
                          </Combobox.Label>
                          <div className="w-full relative flex items-center">
                            <Combobox.Input
                              className="w-full"
                              onChange={(event) => setServiceQuery(event.target.value)}
                              displayValue={(service: RailwayServiceType) => service?.name!}
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
                            <div className="bg-zinc-300 dark:bg-zinc-800 p-2 rounded-md shadow-2xl z-20 absolute max-h-80 w-full overflow-y-auto">
                              {filteredServices.map((service: RailwayServiceType) => (
                                <Combobox.Option key={service.id} value={service}>
                                  {({ active, selected }) => (
                                    <div
                                      className={clsx(
                                        'flex flex-col gap-1 p-2 cursor-pointer rounded-md w-full',
                                        active && 'bg-zinc-400 dark:bg-zinc-700'
                                      )}
                                    >
                                      <div className="font-semibold text-black dark:text-white">
                                        {service.name}
                                      </div>
                                      <div className="text-neutral-500 text-2xs">{service.id}</div>
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
              )}
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
