import { Disclosure, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { ReactNode } from 'react'
import { FaCheckCircle, FaChevronRight, FaRegCircle, FaRegDotCircle } from 'react-icons/fa'

import { GetDashboard } from '@/graphql/queries/getDashboard.gql'
import { useQuery } from '@apollo/client'
import { AppType, OrganisationType } from '@/apollo/graphql'
import Link from 'next/link'
import { Button } from '../common/Button'
import { CliInstallCommands } from './CliInstallCommands'
import { RoleLabel } from '../users/RoleLabel'
import Spinner from '../common/Spinner'

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-black dark:text-white font-semibold text-2xl">Getting started</h1>
        <p className="text-neutral-500">
          Learn how to start using the Phase Console by creating an App, setting up your local dev
          environment, adding your team members and setting up a third party integration.
        </p>
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
              <ul className="list-disc list-inside text-sm">
                <li>
                  Apps are where you can store, sync and manage secrets for a project, application
                  or repo.
                </li>
                <li>
                  When you create an App, it will be initilized with 3 default environments for
                  managing secrets: <code>Development</code>, <code>Staging</code> and{' '}
                  <code>Production</code>.
                </li>
              </ul>
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
            title="Install the CLI"
            defaultOpen={!cliSetup && guideStarted}
            progress={cliSetup ? '100%' : '0%'}
          >
            <div className="space-y-4">
              <ul className="list-disc list-inside text-sm">
                <li>
                  The Phase CLI is how you can integrate Phase with your local development
                  environment. You can import secrets from your existing .env files into your App.
                </li>
                <li>
                  The CLI lets you decrypt and inject secrets into your application with{' '}
                  <code>phase run</code>, along with a host of other features to manage secrets.
                </li>
                <li>
                  Install the CLI and run <code>phase auth</code> to authenticate it with your
                  account.
                </li>
              </ul>

              <div className="space-y-2">
                <div
                  className={clsx(
                    'flex items-center gap-2 text-sm',
                    cliSetup ? 'text-emerald-500' : 'text-neutral-500'
                  )}
                >
                  {cliSetup ? <FaCheckCircle /> : <FaRegCircle />}
                  Install and authenticate CLI
                </div>
              </div>

              {!cliSetup && (
                <div className="space-y-2">
                  <div>
                    <CliInstallCommands />
                  </div>
                  <div className="flex gap-4">
                    <Link href="https://docs.phase.dev/cli/install" target="_blank">
                      <Button variant="secondary">View Docs</Button>
                    </Link>
                  </div>
                </div>
              )}
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
                  Team members need accept the invite and join the organisation before they can be
                  added to specific apps to get access to secrets.
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
                  Integrations allow secrets to automatically be synced with third party services.
                </li>
                <li>
                  Integrations handle the syncing of secrets from a specific environment of an App
                  to a resource in a third party service.
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
                  Add 3rd party authentication credentials
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
                  Create a Sync
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
  )
}
