import GetGithubRepos from '@/graphql/queries/syncing/github/getRepos.gql'
import GetGithubOrgs from '@/graphql/queries/syncing/github/getOrgs.gql'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import CreateNewGhDependabotSync from '@/graphql/mutations/syncing/github/CreateGhDependabotSync.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useState } from 'react'
import { Button } from '../../common/Button'
import { EnvironmentType, GitHubRepoType, GitHubOrgType, ProviderCredentialsType } from '@/apollo/graphql'
import { Combobox, RadioGroup, Tab, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { FaAngleDoubleDown, FaCheckCircle, FaChevronDown, FaCircle, FaDotCircle } from 'react-icons/fa'
import { toast } from 'react-toastify'

import { organisationContext } from '@/contexts/organisationContext'
import { ProviderCredentialPicker } from '../ProviderCredentialPicker'
import { SiGithub } from 'react-icons/si'
import { Input } from '@/components/common/Input'

export const CreateGhDependabotSync = (props: { appId: string; closeModal: () => void }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { appId, closeModal } = props

  const [createGhDependabotSync, { loading: creating }] = useMutation(CreateNewGhDependabotSync, {
    onCompleted: () => {
      toast.success('Created new Sync!')
      closeModal()
    },
  })

  const [credential, setCredential] = useState<ProviderCredentialsType | null>(null)

  const [selectedRepo, setSelectedRepo] = useState<GitHubRepoType | undefined>(undefined)
  const [selectedOrg, setSelectedOrg] = useState<GitHubOrgType | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [orgQuery, setOrgQuery] = useState('')

  const [repos, setRepos] = useState<GitHubRepoType[]>([])
  const [orgs, setOrgs] = useState<GitHubOrgType[]>([])
  const [phaseEnv, setPhaseEnv] = useState<EnvironmentType | null>(null)
  const [path, setPath] = useState('/')

  const [isOrgSync, setIsOrgSync] = useState(false)
  const [orgVisibility, setOrgVisibility] = useState<'all' | 'private'>('all')
  const [credentialsValid, setCredentialsValid] = useState(false)

  const visibilityOptions = [
    {
      value: 'all',
      label: 'All repositories',
      description: 'Make this secret available to any repository in the organization.',
    },
    {
      value: 'private',
      label: 'Private repositories',
      description: 'Make this secret available only to private repositories in the organization.',
    },
  ]

  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId,
    },
  })
  const { data: credentialsData } = useQuery(GetSavedCredentials, {
    variables: { orgId: organisation!.id },
  })

  const [getGhRepos, { loading: loadingRepos }] = useLazyQuery(GetGithubRepos)
  const [getGhOrgs, { loading: loadingOrgs }] = useLazyQuery(GetGithubOrgs)

  useEffect(() => {
    if (credentialsData && credentialsData.savedCredentials.length > 0) {
      setCredential(credentialsData.savedCredentials[0])
    }
  }, [credentialsData])

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
      const [reposResult, orgsResult] = await Promise.all([
        getGhRepos({ variables: { credentialId: credential.id } }),
        getGhOrgs({ variables: { credentialId: credential.id } }),
      ])
      if (reposResult.data?.githubRepos) {
        setRepos(reposResult.data.githubRepos)
      }
      if (orgsResult.data?.githubOrgs) {
        setOrgs(orgsResult.data.githubOrgs)
      }
      setCredentialsValid(true)
    } else if (isOrgSync && selectedOrg === undefined) {
      toast.error('Please select an organization to sync with!')
      return false
    } else if (!isOrgSync && selectedRepo === undefined) {
      toast.error('Please select a repo to sync with!')
      return false
    } else {
      if (isOrgSync) {
        await createGhDependabotSync({
          variables: {
            envId: phaseEnv?.id,
            path,
            owner: selectedOrg!.name,
            credentialId: credential.id,
            orgSync: true,
            repoVisibility: orgVisibility,
          },
          refetchQueries: [{ query: GetAppSyncStatus, variables: { appId } }],
        })
      } else {
        await createGhDependabotSync({
          variables: {
            envId: phaseEnv?.id,
            path,
            repoName: selectedRepo!.name,
            owner: selectedRepo!.owner,
            credentialId: credential.id,
            orgSync: false,
          },
          refetchQueries: [{ query: GetAppSyncStatus, variables: { appId } }],
        })
      }
    }
  }

  const filteredRepos = repos.filter((repo) => {
    if (query === '') {
      return true
    }

    const queryLower = query.toLowerCase()
    const repoNameMatches = repo.name?.toLowerCase().includes(queryLower) || false
    const repoOwnerMatches = repo.owner?.toLowerCase().includes(queryLower) || false

    return repoNameMatches || repoOwnerMatches
  })

  const filteredOrgs = orgs.filter((org) => {
    if (orgQuery === '') {
      return true
    }
    return org.name?.toLowerCase().includes(orgQuery.toLowerCase()) || false
  })

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-semibold text-black dark:text-white flex items-center gap-2">
          <SiGithub />
          GitHub Dependabot
        </div>
        <div className="text-neutral-500 text-sm">Sync an environment with GitHub Dependabot.</div>
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
                  providerFilter={'github'}
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
              <div className="relative col-span-2">
                <Tab.Group
                  selectedIndex={isOrgSync ? 1 : 0}
                  onChange={(index: number) => {
                    const orgSync = index === 1
                    setIsOrgSync(orgSync)
                    if (orgSync) {
                      setSelectedRepo(undefined)
                    } else {
                      setSelectedOrg(undefined)
                    }
                  }}
                >
                  <Tab.List className="flex gap-4 w-full border-b border-neutral-500/20 text-zinc-900 dark:text-zinc-100">
                    <Tab as={Fragment}>
                      {({ selected }) => (
                        <div
                          className={clsx(
                            'p-3 font-medium border-b focus:outline-none',
                            selected
                              ? 'border-emerald-500 font-semibold'
                              : 'border-transparent cursor-pointer'
                          )}
                        >
                          Repository
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
                              : 'border-transparent cursor-pointer'
                          )}
                        >
                          Organization
                        </div>
                      )}
                    </Tab>
                  </Tab.List>
                  <Tab.Panels className="py-4">
                    <Tab.Panel>
                      <div className="space-y-6">
                        <Combobox as="div" value={selectedRepo} onChange={setSelectedRepo}>
                          {({ open }) => (
                            <>
                              <div className="space-y-2">
                                <Combobox.Label as={Fragment}>
                                  <label
                                    className="block text-neutral-500 text-sm"
                                    htmlFor="name"
                                  >
                                    GitHub Repository
                                  </label>
                                </Combobox.Label>
                                <div className="w-full relative flex items-center">
                                  <Combobox.Input
                                    className="w-full"
                                    onChange={(event) => setQuery(event.target.value)}
                                    required
                                    displayValue={(repo: GitHubRepoType) =>
                                      repo ? `${repo?.owner}/${repo?.name}` : query || ''
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
                                  <div className="bg-zinc-200 dark:bg-zinc-800 p-2 rounded-b-md shadow-2xl z-20 absolute max-h-96 overflow-y-auto w-full border border-t-none border-neutral-500/20">
                                    {filteredRepos.map((repo: GitHubRepoType) => (
                                      <Combobox.Option
                                        as="div"
                                        key={`${repo.owner}/${repo.name}`}
                                        value={repo}
                                      >
                                        {({ active, selected }) => (
                                          <div
                                            className={clsx(
                                              'flex items-center justify-between gap-2 p-2 cursor-pointer  w-full border-b border-neutral-500/20',
                                              active && 'bg-zinc-300 dark:bg-zinc-700'
                                            )}
                                          >
                                            <div className="flex items-center gap-2">
                                              <SiGithub className="shrink-0 text-black dark:text-white" />
                                              <div>
                                                <div className="font-semibold text-black dark:text-white">
                                                  {repo.name}{' '}
                                                  <span
                                                    className={clsx(
                                                      'text-2xs px-2 py-0.5 rounded-full font-medium',
                                                      repo.type === 'private'
                                                        ? 'bg-amber-100 dark:bg-amber-400/10 text-amber-800 dark:text-amber-400  ring-1 ring-inset ring-amber-400/20'
                                                        : 'bg-neutral-200 dark:bg-neutral-700 ring-1 ring-inset ring-neutral-500/20 text-neutral-500 dark:text-neutral-300'
                                                    )}
                                                  >
                                                    {repo.type}
                                                  </span>
                                                </div>
                                                <div className="text-neutral-500 text-2xs">
                                                  {repo.owner}
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
                      </div>
                    </Tab.Panel>
                    <Tab.Panel>
                      <div className="space-y-6">
                        <Combobox as="div" value={selectedOrg} onChange={setSelectedOrg}>
                          {({ open }) => (
                            <>
                              <div className="space-y-2">
                                <Combobox.Label as={Fragment}>
                                  <label className="block text-neutral-500 text-sm" htmlFor="org">
                                    GitHub Organization
                                  </label>
                                </Combobox.Label>
                                <div className="w-full relative flex items-center">
                                  <Combobox.Input
                                    className="w-full"
                                    onChange={(event) => setOrgQuery(event.target.value)}
                                    required
                                    displayValue={(org: GitHubOrgType) =>
                                      org ? org.name || '' : orgQuery || ''
                                    }
                                    placeholder={
                                      orgs.length === 0
                                        ? 'No organizations found'
                                        : 'Select an organization'
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
                                  <div className="bg-zinc-200 dark:bg-zinc-800 p-2 rounded-b-md shadow-2xl z-20 absolute max-h-96 overflow-y-auto w-full border border-t-none border-neutral-500/20">
                                    {filteredOrgs.length === 0 ? (
                                      <div className="p-2 text-neutral-500 text-sm">
                                        No organizations found
                                      </div>
                                    ) : (
                                      filteredOrgs.map((org: GitHubOrgType) => (
                                        <Combobox.Option as="div" key={org.name} value={org}>
                                          {({ active, selected }) => (
                                            <div
                                              className={clsx(
                                                'flex items-center justify-between gap-2 p-2 cursor-pointer  w-full border-b border-neutral-500/20',
                                                active && 'bg-zinc-300 dark:bg-zinc-700'
                                              )}
                                            >
                                              <div className="flex items-center gap-2">
                                                <SiGithub className="shrink-0 text-black dark:text-white" />
                                                <div>
                                                  <div className="font-semibold text-black dark:text-white">
                                                    {org.name}
                                                  </div>
                                                  <div className="text-neutral-500 text-2xs capitalize">
                                                    {org.role}
                                                  </div>
                                                </div>
                                              </div>
                                              {selected && (
                                                <FaCheckCircle className="shrink-0 text-emerald-500" />
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

                        <RadioGroup value={orgVisibility} onChange={setOrgVisibility}>
                          <RadioGroup.Label as={Fragment}>
                            <label className="block text-neutral-500 text-sm mb-2">
                              Repository Access
                            </label>
                          </RadioGroup.Label>
                          <div className="flex flex-wrap items-center gap-2">
                            {visibilityOptions.map((option) => (
                              <RadioGroup.Option
                                key={option.value}
                                value={option.value}
                                as={Fragment}
                              >
                                {({ active, checked }) => (
                                  <div
                                    className={clsx(
                                      'flex items-center gap-2 py-1 px-2 cursor-pointer bg-zinc-800 border border-zinc-800 rounded-full',
                                      active && 'border-zinc-700',
                                      checked && 'bg-zinc-700'
                                    )}
                                  >
                                    {checked ? (
                                      <FaDotCircle className="text-emerald-500" />
                                    ) : (
                                      <FaCircle />
                                    )}
                                    {option.label}
                                  </div>
                                )}
                              </RadioGroup.Option>
                            ))}
                          </div>
                          <p className="text-xs text-neutral-500 mt-2">
                            {visibilityOptions.find((o) => o.value === orgVisibility)?.description}
                          </p>
                        </RadioGroup>
                      </div>
                    </Tab.Panel>
                  </Tab.Panels>
                </Tab.Group>
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
          <Button
            isLoading={credentialsValid ? creating : loadingRepos || loadingOrgs}
            variant="primary"
            type="submit"
          >
            {credentialsValid ? 'Create' : 'Next'}
          </Button>
        </div>
      </form>
    </div>
  )
}

