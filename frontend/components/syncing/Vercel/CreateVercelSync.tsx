import GetVercelProjects from '@/graphql/queries/syncing/vercel/getProject.gql'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import CreateNewVercelSync from '@/graphql/mutations/syncing/vercel/createVercelSync.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useState } from 'react'
import { Button } from '../../common/Button'
import {
  EnvironmentType,
  ProviderCredentialsType,
  VercelEnvironmentType,
  VercelProjectType,
  VercelTeamProjectsType,
} from '@/apollo/graphql'
import { Combobox, RadioGroup, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { FaAngleDoubleDown, FaChevronDown, FaCircle, FaDotCircle } from 'react-icons/fa'
import { toast } from 'react-toastify'
import { SiVercel } from 'react-icons/si'

import { organisationContext } from '@/contexts/organisationContext'
import { ProviderCredentialPicker } from '../ProviderCredentialPicker'
import { Input } from '@/components/common/Input'

export const CreateVercelSync = (props: { appId: string; closeModal: () => void }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { appId, closeModal } = props

  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: { appId },
  })

  const { data: credentialsData } = useQuery(GetSavedCredentials, {
    variables: { orgId: organisation!.id },
  })

  const [getVercelProjects, { loading }] = useLazyQuery(GetVercelProjects)

  const [createVercelSync, { loading: creating }] = useMutation(CreateNewVercelSync)

  const [credential, setCredential] = useState<ProviderCredentialsType | null>(null)
  const [vercelTeams, setVercelTeams] = useState<VercelTeamProjectsType[]>([])
  const [vercelTeam, setVercelTeam] = useState<VercelTeamProjectsType | null>(null)
  const [teamQuery, setTeamQuery] = useState('')

  const [vercelProject, setVercelProject] = useState<VercelProjectType | null>(null)
  const [projectQuery, setProjectQuery] = useState('')

  const [vercelEnvironment, setVercelEnvironment] = useState<VercelEnvironmentType | null>(null)
  const [envQuery, setEnvQuery] = useState('')

  const [phaseEnv, setPhaseEnv] = useState<EnvironmentType | null>(null)
  const [path, setPath] = useState('/')

  const [secretType, setSecretType] = useState('encrypted')

  const [credentialsValid, setCredentialsValid] = useState(false)

  // Preselect first available credential
  useEffect(() => {
    if (credentialsData?.savedCredentials.length > 0) {
      setCredential(credentialsData.savedCredentials[0])
    }
  }, [credentialsData])

  // Preselect first available environment
  useEffect(() => {
    if (appEnvsData?.appEnvironments.length > 0) {
      setPhaseEnv(appEnvsData.appEnvironments[0])
    }
  }, [appEnvsData])

  // Preselect first available Vercel team
  useEffect(() => {
    if (vercelTeams.length > 0) {
      setVercelTeam(vercelTeams[0])
    }
  }, [vercelTeams])

  const handleSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault()

    if (credential === null) {
      toast.error('Please select credentials to use for this sync')
      return false
    } else if (!credentialsValid) {
      try {
        const { data: projectsData } = await getVercelProjects({
          variables: { credentialId: credential.id },
        })
        if (projectsData?.vercelProjects) {
          setVercelTeams(projectsData.vercelProjects)
          setCredentialsValid(true)
        }
      } catch (error: any) {
        toast.error(error.message)
      }
    } else if (!vercelProject) {
      toast.error('Please select a Vercel project!')
      return false
    } else {
      try {
        await createVercelSync({
          variables: {
            envId: phaseEnv?.id,
            path,
            credentialId: credential.id,
            projectId: vercelProject.id,
            projectName: vercelProject.name,
            teamId: vercelTeam?.id,
            teamName: vercelTeam?.teamName,
            environment: vercelEnvironment?.slug,
            secretType,
          },
          refetchQueries: [{ query: GetAppSyncStatus, variables: { appId } }],
        })

        toast.success('Created new Sync!')
        closeModal()
      } catch (error: any) {
        toast.error(error.message)
      }
    }
  }

  const filteredTeams =
    teamQuery === ''
      ? vercelTeams
      : vercelTeams.filter((team) => team.teamName?.toLowerCase().includes(teamQuery.toLowerCase()))

  const filteredProjects =
    projectQuery === ''
      ? vercelTeam?.projects
      : vercelTeam?.projects?.filter((project) =>
          project!.name?.toLowerCase().includes(projectQuery.toLowerCase())
        )

  const filteredEnvs: VercelEnvironmentType[] =
    envQuery === ''
      ? (vercelProject?.environments as VercelEnvironmentType[]) ?? []
      : ((vercelProject?.environments as VercelEnvironmentType[]) ?? []).filter((env) =>
          env?.name?.toLowerCase().includes(envQuery.toLowerCase())
        )

  const secretTypes = [
    { value: 'plain', label: 'Plain Text' },
    { value: 'encrypted', label: 'Encrypted' },
    { value: 'sensitive', label: 'Sensitive' },
  ]

  // Environment type badge styling
  const envTypeBadgeStyles = {
    all: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
    standard: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    custom: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  }

  return (
    <div className="pt-4 space-y-6">
      <div>
        <div className="text-2xl font-semibold text-black dark:text-white flex items-center gap-2">
          <SiVercel className="text-2xl" />
          Vercel
        </div>
        <div className="text-neutral-500 text-sm">Sync an environment with Vercel.</div>
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
                  providerFilter="vercel"
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
                  <label className="block text-neutral-500 text-sm mb-2">Phase Environment</label>
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

            <div className="flex justify-between items-center gap-4 py-4">
              <div className="border-b border-neutral-500/40 w-full"></div>
              <FaAngleDoubleDown className="shrink-0 text-neutral-500 text-2xl" />
              <div className="border-b border-neutral-500/40 w-full"></div>
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div className="relative">
                <Combobox as="div" value={vercelTeam} onChange={setVercelTeam}>
                  {({ open }) => (
                    <>
                      <div className="space-y-2">
                        <Combobox.Label as={Fragment}>
                          <label className="block text-neutral-500 text-sm">
                            Vercel Team <span className="text-red-500">*</span>
                          </label>
                        </Combobox.Label>
                        <div className="w-full relative flex items-center">
                          <Combobox.Input
                            className="w-full"
                            onChange={(event) => setTeamQuery(event.target.value)}
                            displayValue={(team: VercelTeamProjectsType) => team?.teamName!}
                            required
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
                          <div className="bg-zinc-200 dark:bg-zinc-800 p-2 rounded-b-md shadow-2xl z-20 absolute max-h-80 overflow-y-auto w-full border border-t-none border-neutral-500/20 divide-y divide-neutral-500/20">
                            {filteredTeams.map((team) => (
                              <Combobox.Option as="div" key={team.id} value={team}>
                                {({ active }) => (
                                  <div
                                    className={clsx(
                                      'flex flex-col gap-1 p-2 cursor-pointer rounded-md w-full',
                                      active && 'bg-zinc-300 dark:bg-zinc-700'
                                    )}
                                  >
                                    <div className="font-semibold text-black dark:text-white">
                                      {team.teamName}
                                    </div>
                                    <div className="text-neutral-500 text-2xs">{team.id}</div>
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
              {vercelTeam ? (
                <div className="relative">
                  <Combobox value={vercelProject} onChange={setVercelProject}>
                    {({ open }) => (
                      <>
                        <div className="space-y-2">
                          <Combobox.Label as={Fragment}>
                            <label className="block text-neutral-500 text-sm">
                              Vercel Project <span className="text-red-500">*</span>
                            </label>
                          </Combobox.Label>
                          <div className="w-full relative flex items-center">
                            <Combobox.Input
                              className="w-full"
                              onChange={(event) => setProjectQuery(event.target.value)}
                              displayValue={(project: VercelProjectType) => project?.name!}
                              required
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
                            <div className="bg-zinc-200 dark:bg-zinc-800 p-2 rounded-b-md shadow-2xl z-20 absolute max-h-80 overflow-y-auto w-full border border-t-none border-neutral-500/20 divide-y divide-neutral-500/20">
                              {filteredProjects!.map((project) => (
                                <Combobox.Option key={project!.id} value={project}>
                                  {({ active }) => (
                                    <div
                                      className={clsx(
                                        'flex flex-col gap-1 p-2 cursor-pointer rounded-md w-full',
                                        active && 'bg-zinc-300 dark:bg-zinc-700'
                                      )}
                                    >
                                      <div className="font-semibold text-black dark:text-white">
                                        {project!.name}
                                      </div>
                                      <div className="text-neutral-500 text-2xs">{project!.id}</div>
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
              ) : (
                <div></div>
              )}

              <div className="relative">
                <Combobox value={vercelEnvironment} onChange={setVercelEnvironment}>
                  {({ open }) => (
                    <>
                      <div className="space-y-2">
                        <Combobox.Label as={Fragment}>
                          <label className="block text-neutral-500 text-sm">
                            Project Environment <span className="text-red-500">*</span>
                          </label>
                        </Combobox.Label>
                        <div className="w-full relative flex items-center">
                          <Combobox.Input
                            className="w-full"
                            onChange={(event) => setEnvQuery(event.target.value)}
                            displayValue={(env: VercelEnvironmentType) => env?.name!}
                            required
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
                          <div className="bg-zinc-200 dark:bg-zinc-800 p-2 rounded-b-md shadow-2xl z-20 absolute max-h-80 overflow-y-auto w-full border border-t-none border-neutral-500/20 divide-y divide-neutral-500/20">
                            {filteredEnvs!.map((env) => (
                              <Combobox.Option key={env!.id} value={env}>
                                {({ active }) => (
                                  <div
                                    className={clsx(
                                      'flex items-center gap-1 p-1 cursor-pointer rounded-md w-full justify-between',
                                      active && 'bg-zinc-300 dark:bg-zinc-700'
                                    )}
                                  >
                                    <div>
                                      <div className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">
                                        {env!.name}
                                      </div>
                                      <div className="text-neutral-500 text-2xs font-mono">
                                        {env!.id}
                                      </div>
                                    </div>
                                    <div
                                      className={clsx(
                                        'text-2xs rounded-full px-2 py-0.5 font-medium capitalize',
                                        envTypeBadgeStyles[
                                          env!.type as keyof typeof envTypeBadgeStyles
                                        ]
                                      )}
                                    >
                                      {env!.type}
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

                {/* <RadioGroup value={vercelEnvironment} onChange={setVercelEnvironment}>
                  <RadioGroup.Label as={Fragment}>
                    <label className="block text-neutral-500 text-sm  mb-2">
                      Target Environment <span className="text-red-500">*</span>
                    </label>
                  </RadioGroup.Label>
                  <div className="flex flex-wrap items-center gap-2">
                    {environments.map((env) => (
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
                </RadioGroup> */}
              </div>

              <div>
                <RadioGroup value={secretType} onChange={setSecretType}>
                  <RadioGroup.Label as={Fragment}>
                    <label className="block text-neutral-500 text-sm mb-2">
                      Secret Type <span className="text-red-500">*</span>
                    </label>
                  </RadioGroup.Label>
                  <div className="flex flex-wrap items-center gap-2">
                    {secretTypes.map((type) => (
                      <RadioGroup.Option key={type.value} value={type.value} as={Fragment}>
                        {({ active, checked }) => (
                          <div
                            className={clsx(
                              'flex items-center gap-2 py-1 px-2 cursor-pointer bg-zinc-800 border border-zinc-800 rounded-full',
                              active && 'border-zinc-700',
                              checked && 'bg-zinc-700'
                            )}
                          >
                            {checked ? <FaDotCircle className="text-emerald-500" /> : <FaCircle />}
                            {type.label}
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
