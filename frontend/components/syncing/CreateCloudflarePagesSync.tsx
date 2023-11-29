import GetCfPages from '@/graphql/queries/syncing/cloudflare/getPages.gql'
import GetAppSyncStatus from '@/graphql/queries/syncing/getAppSyncStatus.gql'
import GetAppEnvironments from '@/graphql/queries/secrets/getAppEnvironments.gql'
import CreateNewCfPagesSync from '@/graphql/mutations/syncing/cloudflare/CreateCfPagesSync.gql'
import GetAppSyncs from '@/graphql/queries/syncing/getAppSyncs.gql'
import { useLazyQuery, useMutation, useQuery } from '@apollo/client'
import { encryptAsymmetric } from '@/utils/crypto'
import { Fragment, useEffect, useState } from 'react'
import { Button } from '../common/Button'
import { CloudFlarePagesType, EnvironmentType } from '@/apollo/graphql'
import { Listbox, RadioGroup } from '@headlessui/react'
import clsx from 'clsx'
import { FaAngleDoubleDown, FaChevronDown, FaCircle, FaDotCircle } from 'react-icons/fa'
import { toast } from 'react-toastify'

export const CreateCloudflarePagesSync = (props: { appId: string; onComplete: Function }) => {
  const { appId } = props

  const { data } = useQuery(GetAppSyncStatus, { variables: { appId } })
  const { data: appEnvsData } = useQuery(GetAppEnvironments, {
    variables: {
      appId,
    },
  })
  const [getCloudflarePages, { data: pagesData, loading }] = useLazyQuery(GetCfPages)

  const [createCfPagesSync, { data: syncData, loading: creating }] =
    useMutation(CreateNewCfPagesSync)

  const [accessToken, setAccessToken] = useState('')
  const [accountId, setAccountId] = useState('')
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

    const encryptedAccountId = await encryptAsymmetric(accountId, data.serverPublicKey)
    const encryptedAccessToken = await encryptAsymmetric(accessToken, data.serverPublicKey)

    if (!credentialsValid) {
      await getCloudflarePages({
        variables: {
          accountId: encryptedAccountId,
          accessToken: encryptedAccessToken,
        },
      })
    } else {
      await createCfPagesSync({
        variables: {
          envId: phaseEnv?.id,
          projectName: cfProject?.name,
          deploymentId: cfProject?.deploymentId,
          projectEnv: cfEnv,
          accessToken: encryptedAccessToken,
          accountId: encryptedAccountId,
        },
        refetchQueries: [{ query: GetAppSyncs, variables: { appId } }],
      })

      toast.success('Created new Sync!')
      props.onComplete()
    }
  }

  const cfProjects: CloudFlarePagesType[] = pagesData?.cloudflarePagesProjects ?? []

  const cfEnvOptions = ['preview', 'production']

  return (
    <div className="p-4 space-y-6">
      <div>
        <div className="text-2xl font-semibold">Cloudflare Pages</div>
        <div className="text-neutral-500">Sync an environment with Cloudflare pages.</div>
      </div>
      <form onSubmit={handleSubmit}>
        {!credentialsValid && (
          <div className="space-y-4">
            <div className="space-y-2 w-full">
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="accountId">
                Account ID
              </label>
              <div className="flex justify-between w-full bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40  focus-within:ring-1 focus-within:ring-inset focus-within:ring-emerald-500 rounded-md p-px">
                <input
                  id="password"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  required
                  autoFocus
                  className="custom w-full text-zinc-800 font-mono dark:text-white bg-zinc-100 dark:bg-zinc-800 rounded-md ph-no-capture"
                />
              </div>
            </div>

            <div className="space-y-2 w-full">
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="token">
                API Token
              </label>
              <div className="flex justify-between w-full bg-zinc-100 dark:bg-zinc-800 ring-1 ring-inset ring-neutral-500/40  focus-within:ring-1 focus-within:ring-inset focus-within:ring-emerald-500 rounded-md p-px">
                <input
                  id="token"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  required
                  className="custom w-full text-zinc-800 font-mono dark:text-white bg-zinc-100 dark:bg-zinc-800 rounded-md ph-no-capture"
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

            <div className="flex justify-between items-center gap-4">
              <div className="border-b border-neutral-500/40 w-full"></div>
              <FaAngleDoubleDown className="shrink-0 text-neutral-500" />
              <div className="border-b border-neutral-500/40 w-full"></div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <div className="space-y-2">
                <label className="block text-gray-700 text-sm font-bold mb-2">
                  Cloudflare Project
                </label>
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
                        <div className="bg-zinc-300 dark:bg-zinc-800 p-2 rounded-md shadow-2xl absolute z-10">
                          {cfProjects.map((project) => (
                            <Listbox.Option
                              key={project.deploymentId}
                              value={project}
                              as={Fragment}
                            >
                              {({ active, selected }) => (
                                <div
                                  className={clsx(
                                    'flex items-center gap-2 p-2 cursor-pointer rounded-full font-medium',
                                    active && 'bg-zinc-400 dark:bg-zinc-700'
                                  )}
                                >
                                  {project.name}
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
