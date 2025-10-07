import GetGithubRepos from '@/graphql/queries/syncing/github/getRepos.gql'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import GetSavedCredentials from '@/graphql/queries/syncing/getSavedCredentials.gql'
import CreateNewGhActionsSync from '@/graphql/mutations/syncing/github/CreateGhActionsSync.gql'
import GetGithubEnvironments from '@/graphql/queries/syncing/github/getEnvironments.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { Fragment, useContext, useEffect, useState } from 'react'
import { Button } from '../../common/Button'
import { EnvironmentType, GitHubRepoType, ProviderCredentialsType } from '@/apollo/graphql'
import { Combobox, RadioGroup, Transition } from '@headlessui/react'
import clsx from 'clsx'
import {
  FaAngleDoubleDown,
  FaCheckCircle,
  FaChevronDown,
  FaCircle,
  FaDotCircle,
} from 'react-icons/fa'
import { toast } from 'react-toastify'

import { organisationContext } from '@/contexts/organisationContext'
import { ProviderCredentialPicker } from '../ProviderCredentialPicker'
import { SiGithub } from 'react-icons/si'
import { Input } from '@/components/common/Input'

export const CreateGhActionsSync = (props: { appId: string; closeModal: () => void }) => {
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const { appId, closeModal } = props

  const [createGhActionsSync, { data: syncData, loading: creating }] =
    useMutation(CreateNewGhActionsSync)

  const [credential, setCredential] = useState<ProviderCredentialsType | null>(null)

  const [selectedRepo, setSelectedRepo] = useState<GitHubRepoType | undefined>(undefined)
  const [selectedEnvironment, setSelectedEnvironment] = useState<string | undefined>(undefined)
  const [query, setQuery] = useState('')
  const [envQuery, setEnvQuery] = useState('')

  const [repos, setRepos] = useState<GitHubRepoType[]>([])
  const [phaseEnv, setPhaseEnv] = useState<EnvironmentType | null>(null)
  const [path, setPath] = useState('/')

  const [credentialsValid, setCredentialsValid] = useState(false)

  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId,
    },
  })
  const { data: credentialsData } = useQuery(GetSavedCredentials, {
    variables: { orgId: organisation!.id },
  })

  const [getGhRepos] = useLazyQuery(GetGithubRepos)

  const { data: environmentsData } = useQuery(GetGithubEnvironments, {
    variables: {
      credentialId: credential?.id,
      owner: selectedRepo?.owner,
      repoName: selectedRepo?.name,
    },
    skip: !credential || !selectedRepo, // Only fetch when we have both credential and selected repo
  })

  const environments = environmentsData?.githubEnvironments || []

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
      const { data: reposData } = await getGhRepos({
        variables: {
          credentialId: credential.id,
        },
      })
      if (reposData?.githubRepos) {
        setRepos(reposData?.githubRepos)
        setCredentialsValid(true)
      }
    } else if (selectedRepo === undefined) {
      toast.error('Please select a repo to sync with!')
      return false
    } else {
      await createGhActionsSync({
        variables: {
          envId: phaseEnv?.id,
          path,
          repoName: selectedRepo.name,
          owner: selectedRepo.owner,
          credentialId: credential.id,
          environmentName: selectedEnvironment || null,
        },
        refetchQueries: [{ query: GetAppSyncStatus, variables: { appId } }],
      })
      toast.success('Created new Sync!')
      closeModal()
    }
  }

  const filteredRepos = repos.filter((repo) => {
    if (query === '') {
      return true // If the query is empty, include all repos
    }

    const queryLower = query.toLowerCase()
    const repoNameMatches = repo.name?.toLowerCase().includes(queryLower) || false
    const repoOwnerMatches = repo.owner?.toLowerCase().includes(queryLower) || false

    return repoNameMatches || repoOwnerMatches // Include the repo if either name or owner matches the query
  })

  return (
    <div className="space-y-6">
      <div>
        <div className="text-2xl font-semibold text-black dark:text-white flex items-center gap-2">
          <SiGithub />
          GitHub Actions
        </div>
        <div className="text-neutral-500 text-sm">Sync an environment with GitHub Actions.</div>
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
                <Combobox as="div" value={selectedRepo} onChange={setSelectedRepo}>
                  {({ open }) => (
                    <>
                      <div className="space-y-2">
                        <Combobox.Label as={Fragment}>
                          <label className="block text-neutral-500 text-sm" htmlFor="name">
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
              <div className="relative col-span-2">
                <Combobox as="div" value={selectedEnvironment} onChange={setSelectedEnvironment}>
                  {({ open }) => (
                    <>
                      <div className="space-y-2">
                        <Combobox.Label as={Fragment}>
                          <label className="block text-neutral-500 text-sm" htmlFor="gh-env">
                            GitHub Environment (optional)
                          </label>
                        </Combobox.Label>
                        <div className="w-full relative flex items-center">
                          <Combobox.Input
                            className={clsx(
                              'w-full',
                              !selectedRepo && 'opacity-60 cursor-not-allowed pointer-events-none'
                            )}
                            onChange={(e) => setEnvQuery(e.target.value)}
                            displayValue={(env?: string) => (env ? env : envQuery)}
                            aria-disabled={!selectedRepo}
                            placeholder={
                              !selectedRepo
                                ? 'Select a repository'
                                : environments.length === 0
                                  ? 'No environments found'
                                  : 'Select an environment'
                            }
                          />
                          <div className="absolute inset-y-0 right-2 flex items-center">
                            <Combobox.Button
                              aria-disabled={!selectedRepo}
                              className={clsx(!selectedRepo && 'pointer-events-none')}
                            >
                              <FaChevronDown
                                className={clsx(
                                  'text-neutral-500 transform transition ease',
                                  open ? 'rotate-180' : 'rotate-0',
                                  !selectedRepo && 'opacity-50 cursor-not-allowed'
                                )}
                              />
                            </Combobox.Button>
                          </div>
                        </div>
                      </div>
                      {selectedRepo && (
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
                              <Combobox.Option as="div" key="__none__" value={undefined}>
                                {({ active, selected }) => (
                                  <div
                                    className={clsx(
                                      'flex items-center justify-between gap-2 p-2 cursor-pointer  w-full border-b border-neutral-500/20',
                                      active && 'bg-zinc-300 dark:bg-zinc-700'
                                    )}
                                  >
                                    <div className="text-neutral-500 text-sm">
                                      No environment (repo-level)
                                    </div>
                                    {selected && (
                                      <FaCheckCircle className="shrink-0 text-emerald-500" />
                                    )}
                                  </div>
                                )}
                              </Combobox.Option>
                              {environments
                                .filter((env: string) =>
                                  envQuery
                                    ? env.toLowerCase().includes(envQuery.toLowerCase())
                                    : true
                                )
                                .map((env: string) => (
                                  <Combobox.Option as="div" key={env} value={env}>
                                    {({ active, selected }) => (
                                      <div
                                        className={clsx(
                                          'flex items-center justify-between gap-2 p-2 cursor-pointer  w-full border-b border-neutral-500/20',
                                          active && 'bg-zinc-300 dark:bg-zinc-700'
                                        )}
                                      >
                                        <div className="font-semibold text-black dark:text-white">
                                          {env}
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
                      )}
                    </>
                  )}
                </Combobox>
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
          <Button isLoading={creating} variant="primary" type="submit">
            {credentialsValid ? 'Create' : 'Next'}
          </Button>
        </div>
      </form>
    </div>
  )
}
