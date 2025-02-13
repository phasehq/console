import { organisationContext } from '@/contexts/organisationContext'
import { Menu, Transition } from '@headlessui/react'
import { useContext, Fragment, useEffect, useState } from 'react'
import { Button } from '../common/Button'
import SecretsOneLiner from './SecretsOneLiner'
import { useParams } from 'next/navigation'
import { FaTerminal } from 'react-icons/fa6'
import { GetAppEnvironments } from '@/graphql/queries/secrets/getAppEnvironments.gql'
import { EnvironmentType } from '@/apollo/graphql'
import { useLazyQuery } from '@apollo/client'
import { CommandAuth } from '@/utils/contextSnippets'

type RouteParams = {
  team: string
  app: string
  environment: string | undefined
  path: string[] | undefined
}

export const ProgrammaticAccessMenu = () => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { app, environment, path } = useParams() as RouteParams
  const [getAppEnvs, { data: appEnvsData }] = useLazyQuery(GetAppEnvironments)

  const [auth, setAuth] = useState<CommandAuth | null>(null)

  const envs: EnvironmentType[] = appEnvsData?.appEnvironments ?? []
  const env = environment
    ? envs?.find((env) => env.id === environment)
    : envs?.length > 0
      ? envs[0]
      : undefined

  const pathString = path?.join('/')
  const displayPathString = pathString
    ? pathString?.length < 25
      ? pathString
      : `.../${path![path!.length - 1]}`
    : ''

  useEffect(() => {
    if (app) getAppEnvs({ variables: { appId: app } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app])

  if (!app || !organisation) return <></>

  return (
    <Menu as="div" className="relative">
      {() => (
        <>
          <Menu.Button as={Fragment}>
            <Button variant="secondary" title="One-click programmatic access">
              <FaTerminal className="text-emerald-500" />
              <span className="font-mono">Access</span>
            </Button>
          </Menu.Button>

          <Transition
            enter="transition duration-100 ease-out"
            enterFrom="transform scale-95 opacity-0"
            enterTo="transform scale-100 opacity-100"
            leave="transition duration-75 ease-out"
            leaveFrom="transform scale-100 opacity-100"
            leaveTo="transform scale-95 opacity-0"
            as="div"
            className="absolute w-full min-w-[40rem] z-20 mt-2 right-0 origin-top-right focus:outline-none"
          >
            <Menu.Items as={Fragment}>
              <div className="rounded-md bg-neutral-100/40 dark:bg-neutral-500/10 backdrop-blur-sm shadow-lg ring-1 ring-inset p-px ring-neutral-500/40">
                <div className="p-2 flex items-start justify-between bg-neutral-100 dark:bg-neutral-900 rounded-t-md">
                  <div className="flex-shrink-0 -space-y-1 max-w-[16rem]">
                    <div className="text-neutral-800 dark:text-neutral-200 text-xs font-semibold truncate">
                      One-click secret access
                    </div>
                    <div className="text-neutral-500 text-2xs whitespace-nowrap">
                      Generate token & commands along with <code>app</code>, <code>env</code> and <code>path</code> context
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs flex-shrink-0">
                    <div className="flex-shrink-0">
                      <span className="text-zinc-500">app: </span>
                      <span className="font-mono text-zinc-900 dark:text-zinc-100 font-semibold">
                        {env?.app.name}
                      </span>
                    </div>

                    <div className="flex-shrink-0">
                      <span className="text-zinc-500">env: </span>
                      <span className="font-mono text-zinc-900 dark:text-zinc-100 font-semibold">
                        {env?.name}
                      </span>
                    </div>

                    <div className="flex-shrink-0">
                      {pathString && <span className="text-zinc-500">path: </span>}
                      <span className="font-mono text-zinc-900 dark:text-zinc-100 font-semibold">
                        {displayPathString}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="divide-y divide-neutral-500/20 p-2">
                  <Menu.Item>
                    <div className="py-1">
                      <SecretsOneLiner
                        organisationId={organisation!.id}
                        appId={app}
                        appName={env?.app.name || ''}
                        env={env?.name}
                        path={pathString || ''}
                        placeholder={`phase secrets list`}
                        size="sm"
                        label="CLI"
                        type="cli"
                        auth={auth}
                        setAuth={setAuth}
                      />
                    </div>
                  </Menu.Item>
                  <Menu.Item>
                    <div className="py-1">
                      <SecretsOneLiner
                        organisationId={organisation!.id}
                        appId={app}
                        appName={env?.app.name || ''}
                        env={env?.name}
                        path={pathString || ''}
                        size="sm"
                        label="REST API"
                        type="api"
                        auth={auth}
                        setAuth={setAuth}
                      />
                    </div>
                  </Menu.Item>
                </div>
              </div>
            </Menu.Items>
          </Transition>
        </>
      )}
    </Menu>
  )
}
