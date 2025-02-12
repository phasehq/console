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
  path: string | undefined
}

export const ProgrammaticAccessMenu = () => {
  const { activeOrganisation: organisation } = useContext(organisationContext)
  const { app, environment, path } = useParams() as RouteParams
  const [getAppEnvs, { data: appEnvsData }] = useLazyQuery(GetAppEnvironments)

  const [auth, setAuth] = useState<CommandAuth | null>(null)

  const envs: EnvironmentType[] = appEnvsData?.appEnvironments ?? []
  const env = environment ? envs?.find((env) => env.id === environment) : undefined

  useEffect(() => {
    if (app && environment) getAppEnvs({ variables: { appId: app } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, environment])

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
            className="absolute w-[40rem] z-20 mt-2 right-0 origin-top-right focus:outline-none"
          >
            <Menu.Items as={Fragment}>
              <div className="divide-y divide-neutral-500/20 p-2 rounded-md bg-neutral-100/40 dark:bg-neutral-500/10 backdrop-blur-sm shadow-lg ring-1 ring-inset ring-neutral-500/40">
                <Menu.Item>
                  <div className="py-1">
                    <SecretsOneLiner
                      organisationId={organisation!.id}
                      appId={app}
                      env={env?.name}
                      path={path || ''}
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
                      env={env?.name}
                      path={path || ''}
                      size="sm"
                      label="REST API"
                      type="api"
                      auth={auth}
                      setAuth={setAuth}
                    />
                  </div>
                </Menu.Item>
              </div>
            </Menu.Items>
          </Transition>
        </>
      )}
    </Menu>
  )
}
