import { Disclosure, Menu, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { Fragment, ReactNode, useEffect, useState } from 'react'
import {
  FaArrowRight,
  FaCheckCircle,
  FaChevronRight,
  FaMinusCircle,
  FaPlug,
  FaQuestionCircle,
  FaRegCircle,
  FaRegDotCircle,
  FaSlack,
} from 'react-icons/fa'
import { TbPackages } from 'react-icons/tb'
import { PiMonitorDuotone, PiMagicWandFill, PiTerminalWindow } from 'react-icons/pi'
import { GetDashboard } from '@/graphql/queries/getDashboard.gql'
import { useQuery } from '@apollo/client'
import { AppType, OrganisationType } from '@/apollo/graphql'
import Link from 'next/link'
import { Button } from '../common/Button'
import { CliInstallCommands } from './CliInstallCommands'
import Spinner from '../common/Spinner'
import { Card } from '../common/Card'
import { SiGithub, SiSlack, SiX } from 'react-icons/si'
import { RoleLabel } from '../users/RoleLabel'
import { CliCommand } from './CliCommand'

const TaskPanel = (props: {
  title: string
  progress: string
  defaultOpen: boolean
  children: ReactNode
}) => {
  const { title, progress, defaultOpen, children } = props

  const progressBarColor = progress === '100%' ? 'bg-emerald-500' : 'bg-amber-500'

  const isComplete = progress === '100%'

  return (
    <Disclosure
      as="div"
      defaultOpen={defaultOpen}
      className="ring-1 ring-inset ring-neutral-500/40 rounded-md p-px flex flex-col divide-y divide-neutral-500/30 w-full"
    >
      {({ open }) => (
        <>
          <Disclosure.Button>
            <div>
              <div
                className={clsx(
                  'p-4 flex justify-between items-center gap-8 transition ease  w-full',
                  open
                    ? 'bg-zinc-200 dark:bg-zinc-800 rounded-t-md'
                    : 'bg-zinc-300 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 rounded-md'
                )}
              >
                <div className="flex items-center gap-2">
                  {isComplete ? (
                    <FaCheckCircle className="text-emerald-500" />
                  ) : progress === '0%' ? (
                    <FaRegCircle className="text-neutral-500" />
                  ) : (
                    <FaRegDotCircle className="text-amber-500" />
                  )}
                  <h2 className="text- xl font-semibold text-black dark:text-white">{title}</h2>
                </div>
                <FaChevronRight
                  className={clsx(
                    'transform transition ease text-neutral-500',
                    open ? 'rotate-90' : 'rotate-0'
                  )}
                />
              </div>
              <div
                className={clsx(
                  'h-0.5 w-full bg-neutral-300 dark:bg-neutral-600 text-sm',
                  !open && 'rounded-b-md'
                )}
              >
                <div
                  className={clsx(
                    'h-0.5 w-full ml-0 transition-all ease float-left',
                    progressBarColor,
                    !open && 'rounded-b-md'
                  )}
                  style={{
                    transform: `scaleX(${progress})`,
                    transformOrigin: '0%',
                  }}
                ></div>
              </div>
            </div>
          </Disclosure.Button>

          <Transition
            enter="transition duration-100 ease-out"
            enterFrom="transform scale-95 opacity-0"
            enterTo="transform scale-100 opacity-100"
            leave="transition duration-75 ease-out"
            leaveFrom="transform scale-100 opacity-100"
            leaveTo="transform scale-95 opacity-0"
          >
            <Disclosure.Panel>
              <div className="p-4">{children}</div>
            </Disclosure.Panel>
          </Transition>
        </>
      )}
    </Disclosure>
  )
}

export const GetStarted = (props: { organisation: OrganisationType }) => {
  const { organisation } = props

  const { data, loading } = useQuery(GetDashboard, {
    variables: { organisationId: organisation.id },
  })

  const [showGuide, setShowGuide] = useState(true)

  useEffect(() => {
    const hideGuide = localStorage.getItem('hideGettingStartedGuide')
    if (hideGuide === 'true') {
      setShowGuide(false)
    }
  }, [])

  const clearLocalStorageKey = () => {
    localStorage.removeItem('hideGettingStartedGuide')
  }

  const handleShowGuide = () => {
    setShowGuide(true)
    clearLocalStorageKey()
  }

  const appCreated = data?.apps.length > 0

  const cliSetup = data?.userTokens.length > 0

  const memberInvited = data?.organisationInvites.length > 0
  const memberAdded = data?.organisationMembers.length > 1
  const membersProgress = memberAdded ? '100%' : memberInvited ? '50%' : '0%'

  const syncAuthAdded = data?.savedCredentials.length > 0
  const syncEnabled: boolean = data?.apps.some((app: AppType) => app.syncEnabled)
  const syncCreated = data?.syncs.length > 0
  const integrationProgress = syncCreated
    ? '100%'
    : syncEnabled
      ? '66%'
      : syncAuthAdded
        ? '33%'
        : '0%'

  const guideStarted: boolean =
    appCreated ||
    cliSetup ||
    memberInvited ||
    memberAdded ||
    syncAuthAdded ||
    syncEnabled ||
    syncCreated

  const DismissButton = () => {
    const handleDismiss = () => {
      localStorage.setItem('hideGettingStartedGuide', 'true')
      setShowGuide(false)
    }

    return (
      <Button variant="secondary" onClick={handleDismiss}>
        <FaMinusCircle /> Dismiss
      </Button>
    )
  }

  const resources = [
    {
      href: 'https://docs.phase.dev/quickstart',
      title: 'Quickstart',
      description: 'A step-by-step guide on getting up and running with Phase in minutes',
      logo: <PiMagicWandFill className="shrink-0" />,
    },
    {
      href: 'https://docs.phase.dev/console',
      title: 'Console',
      description: 'Complete documentation for the Phase Console',
      logo: <PiMonitorDuotone className="shrink-0" />,
    },
    {
      href: 'https://docs.phase.dev/cli/commands',
      title: 'CLI',
      description: 'Complete documentation for the Phase CLI',
      logo: <PiTerminalWindow className="shrink-0" />,
    },
    {
      href: 'https://docs.phase.dev/integrations',
      title: 'Framework Integrations',
      description:
        'Learn how to inject secrets into frameworks like Node.js, Django, Rails, Laravel etc.',
      logo: <FaPlug className="shrink-0" />,
    },
    {
      href: 'https://slack.phase.dev',
      title: 'Join Slack',
      description: 'Need help? Ping us on Slack',
      logo: <FaSlack className="shrink-0" />,
      linkText: 'Join',
    },
  ]

  if (!showGuide)
    return (
      <div className="flex justify-end">
        <Button onClick={handleShowGuide} variant="secondary">
          <FaQuestionCircle /> Help
        </Button>
      </div>
    )

  return (
    <>
      <div className="flex justify-end">
        <DismissButton />
      </div>
      <div className="flex gap-6">
        <div className="space-y-6 w-2/3">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-black dark:text-white font-semibold text-2xl">Getting started</h1>
              <p className="text-neutral-500">
                Learn how to start using the Phase Console by creating an App, setting up your local
                dev environment, adding your team members and setting up a third party integration.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="p-40 flex items-center justify-center">
              <Spinner size="lg" />
            </div>
          ) : (
            <div className="space-y-4">
              <TaskPanel
                title="Create an App"
                defaultOpen={!appCreated}
                progress={appCreated ? '100%' : '0%'}
              >
                <div className="space-y-4">
                  <div className="text-sm">
                    Apps are where you can store, manage and sync secrets across{' '}
                    <code className="bg-neutral-500/40 rounded-full py-0.5 px-2">Development</code>{' '}
                    <code className="bg-neutral-500/40 rounded-full py-0.5 px-2">Staging</code> and{' '}
                    <code className="bg-neutral-500/40 rounded-full py-0.5 px-2">Production</code>{' '}
                    environments.
                  </div>
                  <div
                    className={clsx(
                      'flex items-center gap-2 text-sm',
                      appCreated ? 'text-emerald-500' : 'text-neutral-500'
                    )}
                  >
                    {appCreated ? <FaCheckCircle /> : <FaRegCircle />}
                    Create an App
                  </div>
                  {!appCreated && (
                    <div className="flex gap-4">
                      <Link href={`/${organisation.name}/apps`}>
                        <Button variant="primary">Go to Apps</Button>
                      </Link>
                      <Link href="https://docs.phase.dev/console/apps" target="_blank">
                        <Button variant="secondary">View Docs</Button>
                      </Link>
                    </div>
                  )}
                </div>
              </TaskPanel>

              <TaskPanel
                title="Install and setup the CLI"
                defaultOpen={!cliSetup && guideStarted}
                progress={cliSetup ? '100%' : '0%'}
              >
                <div className="space-y-4">
                  <div className="text-sm">
                    The Phase CLI is how you can integrate Phase with your local development
                    environment.
                  </div>

                  {/* Show as plain text step before completion */}
                  {!cliSetup && (
                    <>
                      <div>
                        <div className="my-4 text-sm">1. Install the Phase CLI</div>
                        <CliInstallCommands />
                      </div>
                      <div className="space-y-3 text-sm">
                        <div>2. Authenticate</div>
                        <div>
                          <CliCommand command="auth" />
                        </div>
                      </div>
                    </>
                  )}

                  {/* Show as a completed step after completion */}
                  {cliSetup && (
                    <div className="my-4">
                      <div className="space-y-3">
                        <div
                          className={clsx('flex items-center gap-2 text-sm', 'text-emerald-500')}
                        >
                          <FaCheckCircle />
                          Install the Phase CLI
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div
                          className={clsx('flex items-center gap-2 text-sm', 'text-emerald-500')}
                        >
                          <FaCheckCircle />
                          Authenticate
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3 text-sm">
                    <div className="my-4">
                      <div className="space-y-3">
                        <div>3. Link your App</div>
                        <div>
                          <CliCommand command="init" />
                        </div>
                      </div>
                    </div>
                    <div className="my-4">
                      <div className="space-y-3">
                        <div>4. Start your application and inject secrets</div>
                        <div>
                          <CliCommand
                            command="run <your_start_command>"
                            comment="eg: phase run yarn start"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <Link href="https://docs.phase.dev/cli/install" target="_blank">
                        <Button variant="secondary">View Docs</Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </TaskPanel>

              <TaskPanel
                title="Add an Organisation member"
                defaultOpen={!memberAdded && guideStarted}
                progress={membersProgress}
              >
                <div className="space-y-4">
                  <ul className="list-disc list-inside text-sm">
                    <li>Invite team members to collaborate with you and securely share secrets.</li>
                    <li>
                      Team members need accept your invite and join the Organisation before they can
                      be added to specific Apps to get access to Secrets.
                    </li>
                    <li>
                      Team members can be given either the <RoleLabel role="dev" /> or{' '}
                      <RoleLabel role="admin" /> role.
                    </li>
                  </ul>

                  <div className="space-y-2">
                    <div
                      className={clsx(
                        'flex items-center gap-2 text-sm',
                        memberInvited ? 'text-emerald-500' : 'text-neutral-500'
                      )}
                    >
                      {memberInvited ? <FaCheckCircle /> : <FaRegCircle />}
                      Invite a team member
                    </div>
                    <div
                      className={clsx(
                        'flex items-center gap-2 text-sm',
                        memberAdded ? 'text-emerald-500' : 'text-neutral-500'
                      )}
                    >
                      {memberAdded ? <FaCheckCircle /> : <FaRegCircle />}
                      Member joined Organisation
                    </div>
                  </div>

                  {!memberAdded && (
                    <div className="flex gap-4">
                      <Link href={`/${organisation.name}/members`}>
                        <Button variant="primary">Go to Members</Button>
                      </Link>
                      <Link
                        href="https://docs.phase.dev/console/users#add-users-to-an-organisation"
                        target="_blank"
                      >
                        <Button variant="secondary">View Docs</Button>
                      </Link>
                    </div>
                  )}
                </div>
              </TaskPanel>

              <TaskPanel
                title="Set up an Integration"
                defaultOpen={!syncCreated && guideStarted}
                progress={integrationProgress}
              >
                <div className="space-y-4">
                  <ul className="list-disc list-inside text-sm">
                    <li>
                      Integrations sync your secrets from a specific Environment to third-party
                      services.
                    </li>
                    <li>To get started with Integrations, you need to:</li>
                  </ul>

                  <div className="space-y-2">
                    <div
                      className={clsx(
                        'flex items-center gap-2 text-sm',
                        syncAuthAdded ? 'text-emerald-500' : 'text-neutral-500'
                      )}
                    >
                      {syncAuthAdded ? <FaCheckCircle /> : <FaRegCircle />}
                      Add third party Service Credentials
                    </div>
                    <div
                      className={clsx(
                        'flex items-center gap-2 text-sm',
                        syncEnabled ? 'text-emerald-500' : 'text-neutral-500'
                      )}
                    >
                      {syncEnabled ? <FaCheckCircle /> : <FaRegCircle />}
                      Enable syncing for an App
                    </div>
                    <div
                      className={clsx(
                        'flex items-center gap-2 text-sm',
                        syncCreated ? 'text-emerald-500' : 'text-neutral-500'
                      )}
                    >
                      {syncCreated ? <FaCheckCircle /> : <FaRegCircle />}
                      Set up a Sync
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <Link href={`/${organisation.name}/integrations`}>
                      <Button variant="primary">Go to Integrations</Button>
                    </Link>
                    <Link
                      href="https://docs.phase.dev/console/users#add-users-to-an-organisation"
                      target="_blank"
                    >
                      <Button variant="secondary">View Docs</Button>
                    </Link>
                  </div>
                </div>
              </TaskPanel>
            </div>
          )}
        </div>
        <div className="w-1/3 pl-4 border-l border-neutral-500/40 space-y-6">
          <div>
            <h1 className="text-black dark:text-white font-semibold text-2xl">Resources</h1>
            <p className="text-neutral-500">
              Here are some more resources to help you get started with Phase.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {resources.map((resource) => (
              <Card key={resource.title}>
                <Link href={resource.href} target="_blank" className="flex flex-row-reverse gap-6">
                  <div className="flex-auto">
                    <h3 className=" font-semibold text-zinc-900 dark:text-white">
                      {resource.title}
                    </h3>
                    <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                      {resource.description}
                    </p>
                    <div className="mt-4 flex items-center gap-1 text-sm">
                      <div className="flex items-center text-emerald-500">
                        {resource.linkText || 'Explore'}
                      </div>
                      <FaArrowRight className="text-emerald-500 text-xs" />
                    </div>
                  </div>
                  <div className="text-3xl">{resource.logo}</div>
                </Link>
              </Card>
            ))}
          </div>

          <div className="pt-4 border-t border-neutral-500/40">
            <div className="flex items-center gap-4 justify-end">
              <a href="https://slack.phase.dev" target="_blank" rel="noopener noreferrer">
                <SiSlack className="text-neutral-500 hover:text-neutral-600" />
              </a>

              <a href="https://github.com/phasehq" target="_blank" rel="noopener noreferrer">
                <SiGithub className="text-neutral-500 hover:text-neutral-600" />
              </a>

              <a href="https://twitter.com/phasedotdev" target="_blank" rel="noopener noreferrer">
                <SiX className="text-neutral-500 hover:text-neutral-600" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
