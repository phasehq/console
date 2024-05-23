import GetGitLabResources from '@/graphql/queries/syncing/gitlab/getResources.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import CreateNewGitlabCiSync from '@/graphql/mutations/syncing/gitlab/createGitlabCISync.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useState } from 'react'
import { Button } from '../../common/Button'
import {
  EnvironmentType,
  GitLabGroupType,
  GitLabProjectType,
  ProviderCredentialsType,
} from '@/apollo/graphql'
import { Combobox, RadioGroup, Tab, Transition } from '@headlessui/react'
import clsx from 'clsx'
import {
  FaAngleDoubleDown,
  FaCheckCircle,
  FaChevronDown,
  FaCircle,
  FaDotCircle,
  FaExclamationCircle,
  FaExternalLinkSquareAlt,
} from 'react-icons/fa'
import { toast } from 'react-toastify'

import { organisationContext } from '@/contexts/organisationContext'
import { ProviderCredentialPicker } from '../ProviderCredentialPicker'
import { Input } from '@/components/common/Input'
import { ProviderIcon } from '../ProviderIcon'
import { ToggleSwitch } from '@/components/common/ToggleSwitch'
import Link from 'next/link'
import { Alert } from '@/components/common/Alert'

export const CreateGitLabCISync = (props: { appId: string; closeModal: () => void }) => {
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

  const [getGitLabResources, { loading }] = useLazyQuery(GetGitLabResources)

  const [createGitlabCiSync, { data: syncData, loading: creating }] =
    useMutation(CreateNewGitlabCiSync)

  const [credential, setCredential] = useState<ProviderCredentialsType | null>(null)

  const [projects, setProjects] = useState<GitLabProjectType[]>([])
  const [groups, setGroups] = useState<GitLabGroupType[]>([])

  const [selectedProject, setSelectedProject] = useState<GitLabProjectType | undefined>(undefined)

  const [selectedGroup, setSelectedGroup] = useState<GitLabGroupType | undefined>(undefined)

  const [isGroup, setIsGroup] = useState(false)

  const [projectsQuery, setProjectsQuery] = useState('')
  const [groupsQuery, setGroupsQuery] = useState('')

  const [phaseEnv, setPhaseEnv] = useState<EnvironmentType | null>(null)
  const [path, setPath] = useState('/')

  const [isMasked, setMasked] = useState(false)
  const [isProtected, setProtected] = useState(false)

  const [credentialsValid, setCredentialsValid] = useState(false)

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
      const { data: gitlabData } = await getGitLabResources({
        variables: {
          credentialId: credential.id,
        },
        fetchPolicy: 'network-only',
      })
      if (gitlabData) {
        setProjects(gitlabData?.gitlabProjects || [])
        setGroups(gitlabData?.gitlabGroups || [])
        setCredentialsValid(true)
      }
    } else if (isGroup && !selectedGroup) {
      toast.error('Please select a group to sync with!')
      return false
    } else if (!isGroup && !selectedProject) {
      toast.error('Please select a project to sync with!')
      return false
    } else {
      await createGitlabCiSync({
        variables: {
          envId: phaseEnv?.id,
          path,
          credentialId: credential.id,
          resourcePath: isGroup ? selectedGroup?.path : selectedProject?.pathWithNamespace,
          isGroup,
          isMasked,
          isProtected,
        },
        refetchQueries: [{ query: GetAppSyncStatus, variables: { appId } }],
      })
      toast.success('Created new Sync!')
      closeModal()
    }
  }

  const filteredProjects = projects.filter((project) => {
    if (projectsQuery === '') {
      return true // If the query is empty, include all projects
    }

    const queryLower = projectsQuery.toLowerCase()
    const nameMatches = project.name?.toLowerCase().includes(queryLower) || false
    const namespaceMatches = project.namespace?.name?.toLowerCase().includes(queryLower) || false

    return nameMatches || namespaceMatches
  })

  const filteredGroups = groups.filter((group) => {
    if (groupsQuery === '') {
      return true // If the query is empty, include all groups
    }

    const queryLower = groupsQuery.toLowerCase()
    const nameMatches = group.name?.toLowerCase().includes(queryLower) || false

    return nameMatches
  })

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-semibold text-black dark:text-white flex items-center gap-2">
          <ProviderIcon providerId="gitlab" />
          GitLab CI
        </div>
        <div className="text-neutral-500 text-sm">Sync an environment with GitLab CI.</div>
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
                  providerFilter={'gitlab'}
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

            <div className="flex justify-between items-center gap-4 py-4">
              <div className="border-b border-neutral-500/40 w-full"></div>
              <FaAngleDoubleDown className="shrink-0 text-neutral-500 text-2xl" />
              <div className="border-b border-neutral-500/40 w-full"></div>
            </div>

            <div className="grid grid-cols-2 gap-8">
              <div className="relative col-span-2">
                <Tab.Group
                  selectedIndex={isGroup ? 1 : 0}
                  onChange={(index: number) => setIsGroup(index === 0 ? false : true)}
                >
                  <Tab.List className="flex gap-4 w-full border-b border-neutral-500/20">
                    <Tab as={Fragment}>
                      {({ selected }) => (
                        <div
                          className={clsx(
                            'p-3 font-medium border-b focus:outline-none',
                            selected
                              ? 'border-emerald-500 font-semibold'
                              : ' border-transparent cursor-pointer'
                          )}
                        >
                          GitLab Projects
                        </div>
                      )}
                    </Tab>
                    <Tab as={Fragment}>
                      {({ selected }) => (
                        <div
                          className={clsx(
                            'p-3 font-medium border-b focus:outline-none',
                            selected
                              ? 'border-emerald-500 font-semibold'
                              : ' border-transparent cursor-pointer'
                          )}
                        >
                          GitLab Groups
                        </div>
                      )}
                    </Tab>
                  </Tab.List>
                  <Tab.Panels className="py-4">
                    <Tab.Panel>
                      <Combobox value={selectedProject} onChange={setSelectedProject}>
                        {({ open }) => (
                          <>
                            <div className="space-y-2">
                              <Combobox.Label as={Fragment}>
                                <label
                                  className="block text-gray-700 text-sm font-bold"
                                  htmlFor="name"
                                >
                                  GitLab Project
                                </label>
                              </Combobox.Label>
                              <div className="w-full relative flex items-center">
                                <Combobox.Input
                                  className="w-full"
                                  onChange={(event) => setProjectsQuery(event.target.value)}
                                  required
                                  displayValue={(project: GitLabProjectType) =>
                                    project
                                      ? `${project?.namespace?.name}/${project?.name}`
                                      : projectsQuery || ''
                                  }
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
                                <div className="bg-zinc-200 dark:bg-zinc-800 p-2 rounded-md shadow-2xl z-20 absolute max-h-96 w-full overflow-y-auto">
                                  {filteredProjects.map((project: GitLabProjectType) => (
                                    <Combobox.Option
                                      key={`${project.namespace?.name}/${project.name}`}
                                      value={project}
                                    >
                                      {({ active, selected }) => (
                                        <div
                                          className={clsx(
                                            'flex items-center justify-between gap-2 p-2 cursor-pointer  w-full border-b border-neutral-500/20',
                                            active && 'bg-zinc-300 dark:bg-zinc-700'
                                          )}
                                        >
                                          <div className="flex items-center gap-2">
                                            <ProviderIcon providerId="gitlab" />
                                            <div>
                                              <div className="font-semibold text-black dark:text-white">
                                                {project.name}{' '}
                                              </div>
                                              <div className="text-neutral-500 text-2xs">
                                                {project.namespace?.name}
                                              </div>
                                            </div>
                                          </div>
                                          {selected && (
                                            <FaCheckCircle className="shrink-0 text-emerald-500" />
                                          )}
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
                    </Tab.Panel>
                    <Tab.Panel>
                      <Combobox value={selectedGroup} onChange={setSelectedGroup}>
                        {({ open }) => (
                          <>
                            <div className="space-y-2">
                              <Combobox.Label as={Fragment}>
                                <label
                                  className="block text-gray-700 text-sm font-bold"
                                  htmlFor="name"
                                >
                                  GitLab Group
                                </label>
                              </Combobox.Label>
                              <div className="w-full relative flex items-center">
                                <Combobox.Input
                                  className="w-full"
                                  onChange={(event) => setGroupsQuery(event.target.value)}
                                  required
                                  displayValue={(group: GitLabGroupType) =>
                                    group ? group?.name! : groupsQuery || ''
                                  }
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
                                <div className="bg-zinc-200 dark:bg-zinc-800 p-2 rounded-md w-full shadow-2xl z-20 absolute max-h-96 overflow-y-auto">
                                  {filteredGroups.map((group: GitLabGroupType) => (
                                    <Combobox.Option key={group.name} value={group}>
                                      {({ active, selected }) => (
                                        <div
                                          className={clsx(
                                            'flex items-center justify-between gap-2 p-2 cursor-pointer  w-full border-b border-neutral-500/20',
                                            active && 'bg-zinc-300 dark:bg-zinc-700'
                                          )}
                                        >
                                          <div className="flex items-center gap-2">
                                            <ProviderIcon providerId="gitlab" />
                                            <div>
                                              <div className="font-semibold text-black dark:text-white">
                                                {group.name}{' '}
                                              </div>
                                            </div>
                                          </div>
                                          {selected && (
                                            <FaCheckCircle className="shrink-0 text-emerald-500" />
                                          )}
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
                    </Tab.Panel>
                  </Tab.Panels>
                </Tab.Group>
              </div>

              <div className="col-span-2 space-y-4 divide-y divide-neutral-500/20">
                <div className="flex items-center justify-between">
                  <div
                    className={clsx(
                      'space-y-1 font-medium text-sm',
                      isProtected ? 'text-zinc-900 dark:text-zinc-100' : 'text-neutral-500'
                    )}
                  >
                    Protect variables
                  </div>
                  <ToggleSwitch value={isProtected} onToggle={() => setProtected(!isProtected)} />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between pt-3">
                    <div
                      className={clsx(
                        'space-y-1 font-medium text-sm',
                        isMasked ? 'text-zinc-900 dark:text-zinc-100' : 'text-neutral-500'
                      )}
                    >
                      Mask variables
                    </div>
                    <ToggleSwitch value={isMasked} onToggle={() => setMasked(!isMasked)} />
                  </div>
                  {isMasked && (
                    <Alert variant="info" icon={true} size="sm">
                      <div>
                        Masked variables must meet certain criteria to be synced to GitLab. Make
                        sure your variables and secrets meet the criteria, or your sync jobs will
                        fail.{' '}
                        <Link
                          href="https://docs.gitlab.com/ee/ci/variables/#mask-a-cicd-variable"
                          target="_blank"
                          rel="noreferrer"
                        >
                          <div className="flex items-center gap-1 underline">
                            GitLab Docs <FaExternalLinkSquareAlt />
                          </div>
                        </Link>
                      </div>
                    </Alert>
                  )}
                </div>
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
