import React, { useState, useEffect, Fragment, useContext, useRef } from 'react'
import { Combobox, Dialog, Transition } from '@headlessui/react'
import {
  FaBolt,
  FaBook,
  FaCog,
  FaCompass,
  FaCube,
  FaCubes,
  FaExchangeAlt,
  FaGithub,
  FaHome,
  FaKey,
  FaMoon,
  FaPlus,
  FaProjectDiagram,
  FaRobot,
  FaSearch,
  FaSun,
  FaUserPlus,
  FaUsers,
  FaUsersCog,
} from 'react-icons/fa'
import { useRouter } from 'next/navigation'
import { useQuery } from '@apollo/client'
import { GetApps } from '@/graphql/queries/getApps.gql'
import { organisationContext } from '@/contexts/organisationContext'
import { ThemeContext } from '@/contexts/themeContext'
import { BsListColumnsReverse } from 'react-icons/bs'
import { FaArrowsRotate, FaCodeMerge, FaListCheck } from 'react-icons/fa6'
import { userHasPermission } from '@/utils/access/permissions'

type CommandItem = {
  id: string
  name: string
  description: string
  icon: React.ReactNode
  action: () => void
}

type CommandGroup = {
  name: string
  items: CommandItem[]
  icon: React.ReactNode
}

const CommandPalette: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [modifierKey, setModifierKey] = useState('')
  const router = useRouter()
  const { activeOrganisation, organisations } = useContext(organisationContext)
  const { theme, setTheme } = useContext(ThemeContext)

  // Permission checks
  const userCanReadApps = userHasPermission(activeOrganisation?.role?.permissions, 'Apps', 'read')
  const userCanCreateApps = userHasPermission(
    activeOrganisation?.role?.permissions,
    'Apps',
    'create'
  )
  const userCanInviteUsers = userHasPermission(
    activeOrganisation?.role?.permissions,
    'Members',
    'create'
  )

  const { data: appsData } = useQuery(GetApps, {
    variables: { organisationId: activeOrganisation?.id },
    skip: !activeOrganisation?.id || !userCanReadApps,
  })

  const handleNavigation = (url: string) => {
    router.push(url)
    setIsOpen(false)
  }

  const navigationCommands: CommandItem[] = [
    {
      id: 'go-home',
      name: `Go to ${activeOrganisation?.name} Home`,
      description: 'Navigate to the home page',
      icon: <FaHome />,
      action: () => handleNavigation(`/${activeOrganisation?.name}`),
    },
    {
      id: 'go-all-apps',
      name: 'Go to Apps',
      description: 'View all applications',
      icon: <FaCubes />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/apps`),
    },
    {
      id: 'go-members',
      name: 'Go to Members',
      description: 'Manage organization members',
      icon: <FaUsersCog />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/access/members`),
    },
    {
      id: 'go-service-accounts',
      name: 'Go to Service Accounts',
      description: 'Manage organization service accounts',
      icon: <FaRobot />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/access/service-accounts`),
    },
    {
      id: 'go-integrations',
      name: 'Go to Integrations',
      description: 'Manage integrations',
      icon: <FaProjectDiagram />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/integrations`),
    },
    {
      id: 'go-pat',
      name: 'Go to Access Control',
      description: 'Navigate to access control',
      icon: <FaKey />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/access/members`),
    },
    {
      id: 'go-settings',
      name: 'Go to Settings',
      description: 'Navigate to settings page',
      icon: <FaCog />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/settings`),
    },
  ]

  // Conditionally add the "Switch Organization" command
  if (organisations?.length! > 1) {
    navigationCommands.push({
      id: 'switch-org',
      name: 'Switch organization workspace',
      description: 'Switch to a different organization workspace',
      icon: <FaExchangeAlt />,
      action: () => handleNavigation('/'),
    })
  }

  const actionCommands: CommandItem[] = [
    {
      id: 'toggle-theme',
      name: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
      description: 'Switch between dark and light mode',
      icon: theme === 'dark' ? <FaSun /> : <FaMoon />,
      action: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    },
  ]

  if (userCanCreateApps)
    actionCommands.push({
      id: 'create-app',
      name: 'Create an App',
      description: 'Create a new application',
      icon: <FaPlus />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/apps/?new=true`),
    })

  if (userCanInviteUsers)
    actionCommands.push({
      id: 'invite-user',
      name: 'Invite a User',
      description: 'Invite a new user to the organization',
      icon: <FaUserPlus />,
      action: () => handleNavigation(`/${activeOrganisation?.name}/access/members?invite=true`),
    })

  const externalResources: CommandItem[] = [
    {
      id: 'open-docs',
      name: 'Open Docs',
      description: 'View the Phase documentation',
      icon: <FaBook />,
      action: () => window.open('https://docs.phase.dev', '_blank'),
    },
    {
      id: 'open-github',
      name: 'View Phase on GitHub',
      description: 'View the Phase GitHub',
      icon: <FaGithub />,
      action: () => window.open('https://github.com/phasehq/console', '_blank'),
    },
    {
      id: 'open-changelog',
      name: 'Read the changelog',
      description: 'View the latest features and updates to Phase',
      icon: <FaCodeMerge />,
      action: () => window.open('https://phase.dev/changelog', '_blank'),
    },
  ]

  const appCommands: CommandGroup[] =
    appsData?.apps?.map((app: any) => ({
      name: app.name,
      icon: <FaCube />,
      items: [
        {
          id: `${app.id}-home`,
          name: `${app.name} Home`,
          description: `Go to ${app.name}`,
          icon: <FaCube />,
          action: () => handleNavigation(`/${activeOrganisation?.name}/apps/${app.id}`),
        },
        ...(app.environments?.map((env: any) => ({
          id: `${app.id}-${env.id}`,
          name: `${env.name}`,
          description: `Explore the ${env.name} environment of ${app.name}`,
          icon: <BsListColumnsReverse />,
          action: () =>
            handleNavigation(`/${activeOrganisation?.name}/apps/${app.id}/environments/${env.id}`),
        })) || []),
        {
          id: `${app.id}-tokens`,
          name: `Service tokens`,
          description: `Manage service tokens for ${app.name}`,
          icon: <FaKey />,
          action: () =>
            handleNavigation(`/${activeOrganisation?.name}/apps/${app.id}/access/tokens`),
        },
        {
          id: `${app.id}-members`,
          name: `Members`,
          description: `Manage members in ${app.name}`,
          icon: <FaUsers />,
          action: () =>
            handleNavigation(`/${activeOrganisation?.name}/apps/${app.id}/access/members`),
        },
        {
          id: `${app.id}-service-accounts`,
          name: `Service Accounts`,
          description: `Manage service accounts in ${app.name}`,
          icon: <FaRobot />,
          action: () =>
            handleNavigation(`/${activeOrganisation?.name}/apps/${app.id}/access/service-accounts`),
        },
        {
          id: `${app.id}-syncing`,
          name: `Syncing`,
          description: `Manage syncing and integrations for ${app.name}`,
          icon: <FaArrowsRotate />,
          action: () => handleNavigation(`/${activeOrganisation?.name}/apps/${app.id}/syncing`),
        },
        {
          id: `${app.id}-logs`,
          name: `Logs`,
          description: `View logs for ${app.name}`,
          icon: <FaListCheck />,
          action: () => handleNavigation(`/${activeOrganisation?.name}/apps/${app.id}/logs`),
        },
      ],
    })) || []

  const allCommands: CommandGroup[] = [
    {
      name: 'Actions',
      icon: <FaBolt />,
      items: actionCommands,
    },
    {
      name: 'Navigation',
      icon: <FaCompass />,
      items: navigationCommands,
    },
    ...(appCommands.length > 0 ? appCommands : []),
    {
      name: 'Resources',
      icon: <FaBook />,
      items: externalResources,
    },
  ]

  const flattenedCommands = allCommands.flatMap((group) => group.items)

  const filteredCommands = React.useMemo(() => {
    if (query === '') return flattenedCommands

    const keywords = query.toLowerCase().split(/\s+/)

    return flattenedCommands.filter((command) => {
      const searchableText = `${command.name} ${command.description}`.toLowerCase()
      return keywords.every((keyword) => searchableText.includes(keyword))
    })
  }, [query, flattenedCommands])

  useEffect(() => {
    const detectPlatform = () => {
      const userAgent = navigator.userAgent.toLowerCase()
      if (userAgent.includes('mac')) return 'macOS'
      if (userAgent.includes('iphone') || userAgent.includes('ipad') || userAgent.includes('ipod'))
        return 'iOS'
      if (userAgent.includes('win')) return 'Windows'
      if (userAgent.includes('linux')) return 'Linux'
      return 'Unknown'
    }

    const platform = detectPlatform()
    setModifierKey(/^(mac|ios)/i.test(platform) ? '⌘' : 'Ctrl')
  }, [])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setIsOpen((open) => !open)
      }
    }

    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  const isOpenRef = useRef(isOpen)

  useEffect(() => {
    isOpenRef.current = isOpen
  }, [isOpen])

  const handleOptionSelection = (item: CommandItem) => {
    setTimeout(() => {
      if (isOpenRef.current) {
        item.action()
        setIsOpen(false)
      }
    }, 100)
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="w-full max-w-xl h-9 flex items-center gap-2 rounded-full bg-white/80 dark:bg-zinc-800/80 backdrop-blur-sm pl-4 pr-3 text-sm text-zinc-500  ring-1 ring-zinc-900/10 dark:ring-white/10 ring-inset transition hover:ring-zinc-900/20 dark:hover:ring-white/20 ui-not-focus-visible:outline-none"
      >
        <div>
          <FaSearch className="h-4 w-4 flex-shrink-0" />
        </div>
        <span className="flex-grow text-left truncate">Find something...</span>
        <kbd className="flex-shrink-0 text-2xs text-zinc-400 dark:text-zinc-500">
          <kbd className="font-sans">{modifierKey}</kbd>
          <kbd className="font-sans"> + K</kbd>
        </kbd>
      </button>

      <Transition.Root show={isOpen} as={Fragment} afterLeave={() => setQuery('')}>
        <Dialog
          onClose={setIsOpen}
          className="fixed inset-0 z-50 overflow-y-auto p-4 sm:p-6 md:p-20"
        >
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <Dialog.Overlay className="fixed inset-0 bg-zinc-400/25 dark:bg-black/40 backdrop-blur-sm" />
          </Transition.Child>

          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Combobox
              as="div"
              className="mx-auto max-w-xl transform divide-y divide-neutral-500/30 overflow-hidden rounded-xl bg-white/80 dark:bg-zinc-800/80 shadow-2xl ring-1 ring-black/5 dark:ring-white/10 backdrop-blur-sm backdrop-saturate-150 transition-all"
              onChange={handleOptionSelection}
            >
              <div className="relative flex items-center rounded-xl">
                <FaSearch
                  className="pointer-events-none absolute left-4 text-zinc-500 dark:text-zinc-400"
                  aria-hidden="true"
                />
                <Combobox.Input
                  className="w-full custom caret-emerald-400 border-0 rounded-xl bg-transparent pl-12 pr-4 py-3 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-500 focus:ring-0"
                  placeholder="Type a command or search..."
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>

              {filteredCommands.length > 0 && (
                <Combobox.Options
                  className="max-h-[42rem] overflow-y-auto divide-y divide-neutral-500/20"
                  static
                >
                  {allCommands.map((group, groupIndex) => {
                    const filteredGroupCommands = group.items.filter((command) =>
                      filteredCommands.some((fc) => fc.id === command.id)
                    )

                    if (filteredGroupCommands.length === 0) return null

                    return (
                      <div key={`${group.name}${groupIndex}`}>
                        <div className="text-xs font-semibold text-zinc-400 dark:text-zinc-600 flex items-center gap-2 p-2">
                          <div>{group.icon}</div>
                          {group.name}
                        </div>

                        {filteredGroupCommands.map((item) => (
                          <Combobox.Option key={item.id} value={item} as={Fragment}>
                            {({ active }) => (
                              <li
                                className={`flex cursor-default select-none items-center gap-4 justify-between px-3 py-2 ${
                                  active ? 'bg-zinc-300/50 dark:bg-zinc-700/50' : ''
                                }`}
                              >
                                <div className="flex items-center gap-4">
                                  <div className="flex h-6 w-6 items-center justify-center text-zinc-900 dark:text-zinc-100">
                                    {item.icon}
                                  </div>
                                  <div>
                                    <div className="font-medium text-zinc-900 dark:text-zinc-100 text-sm">
                                      {item.name}
                                    </div>
                                    <div className="text-zinc-500 text-xs">{item.description}</div>
                                  </div>
                                </div>
                                <div>
                                  {active && (
                                    <kbd className="text-2xs text-zinc-400 dark:text-zinc-500">
                                      Enter
                                    </kbd>
                                  )}
                                </div>
                              </li>
                            )}
                          </Combobox.Option>
                        ))}
                      </div>
                    )
                  })}
                </Combobox.Options>
              )}

              {query !== '' && filteredCommands.length === 0 && (
                <div className="py-14 px-6 text-center sm:px-14">
                  <FaSearch
                    className="mx-auto h-6 w-6 text-zinc-500 dark:text-zinc-400"
                    aria-hidden="true"
                  />
                  <p className="mt-4 text-sm text-zinc-700 dark:text-zinc-300">
                    No results found for &quot;<strong className="font-semibold">{query}</strong>
                    &quot;. Please try again.
                  </p>
                </div>
              )}
            </Combobox>
          </Transition.Child>
        </Dialog>
      </Transition.Root>
    </>
  )
}

export default CommandPalette
