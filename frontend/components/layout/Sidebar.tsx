'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import {
  FaChevronDown,
  FaCog,
  FaCubes,
  FaExchangeAlt,
  FaHome,
  FaKey,
  FaPlus,
  FaUsersCog,
  FaProjectDiagram,
} from 'react-icons/fa'
import { organisationContext } from '@/contexts/organisationContext'
import { Fragment, useContext } from 'react'
import { OrganisationType } from '@/apollo/graphql'
import { Menu, Transition } from '@headlessui/react'
import { Button } from '../common/Button'
import { PlanLabel } from '../settings/organisation/PlanLabel'

export type SidebarLinkT = {
  name: string
  href: string
  icon: React.ReactNode
  active: boolean
}

const SidebarLink = (props: SidebarLinkT) => {
  const { name, href, icon, active } = props

  return (
    <Link href={href} title={name}>
      <div
        className={clsx(
          'flex items-center gap-2 text-sm border-l p-3 w-full transition ease rounded-r-lg font-semibold',
          active
            ? 'border-emerald-500 bg-zinc-300 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
            : ' border-transparent text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
        )}
      >
        <div>{icon}</div>
        {name}
      </div>
    </Link>
  )
}

const Sidebar = () => {
  const team = usePathname()?.split('/')[1]

  const { organisations, activeOrganisation } = useContext(organisationContext)

  const showOrgsMenu = organisations && organisations.length > 1

  const isOwner = organisations?.some((org) => org.role!.name!.toLowerCase() === 'owner')

  const OrgsMenu = () => {
    const OrgLabel = () => (
      <div className="p-2 text-neutral-500 flex items-center justify-between w-full bg-neutral-500/10 ring-1 ring-inset ring-neutral-400/10 rounded-lg">
        <div className="flex flex-col gap-0.5 min-w-0 items-start">
          <div>
            <PlanLabel plan={activeOrganisation?.plan!} />
          </div>
          <span className="truncate font-semibold tracking-wider text-lg">
            {activeOrganisation?.name}
          </span>
        </div>
      </div>
    )

    if (!showOrgsMenu) return <OrgLabel />

    return (
      <Menu as="div" className="relative inline-block text-left w-full">
        {({ open }) => (
          <>
            <Menu.Button className="w-full">
              <div className="relative">
                <OrgLabel />
                <FaChevronDown
                  className={clsx(
                    'absolute right-2 top-1/2 -translate-y-1/2 transition-transform',
                    'text-zinc-800 dark:text-zinc-100',
                    open ? 'rotate-180' : 'rotate-0'
                  )}
                />
              </div>
            </Menu.Button>
            <Transition
              as={Fragment}
              enter="transition ease-out duration-100"
              enterFrom="transform opacity-0 scale-95"
              enterTo="transform opacity-100 scale-100"
              leave="transition ease-in duration-75"
              leaveFrom="transform opacity-100 scale-100"
              leaveTo="transform opacity-0 scale-95"
            >
              <Menu.Items className="absolute z-10 left-0 shadow-2xl top-16 mt-2 w-64 origin-bottom-left divide-y divide-neutral-500/40 rounded-md bg-neutral-200 dark:bg-neutral-800 ring-1 ring-inset ring-neutral-500/40 focus:outline-none">
                <div className="px-1 py-1">
                  {organisations?.map((org: OrganisationType) => (
                    <Menu.Item key={org.id}>
                      {({ active }) => (
                        <Link href={`/${org.name}`}>
                          <div
                            title={`Switch to ${org.name}`}
                            className={`${
                              active
                                ? 'hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                                : 'text-zinc-700 dark:text-zinc-300 dark:hover:text-emerald-500'
                            } group flex w-full gap-2 items-center justify-between px-2 py-2 border-b border-neutral-500/20`}
                          >
                            <div className="flex flex-col gap-0.5 min-w-0 flex-grow">
                              <div>
                                <PlanLabel plan={org?.plan!} />
                              </div>
                              <span className="truncate text-left font-medium text-base">
                                {org.name}
                              </span>
                            </div>
                            <FaExchangeAlt className="flex-shrink-0" />
                          </div>
                        </Link>
                      )}
                    </Menu.Item>
                  ))}
                </div>
                {!isOwner && (
                  <div className="py-3 px-1 flex justify-center">
                    <Link href="/signup">
                      <Button variant="secondary">
                        <FaPlus /> Create New Organisation
                      </Button>
                    </Link>
                  </div>
                )}
              </Menu.Items>
            </Transition>
          </>
        )}
      </Menu>
    )
  }

  const links: SidebarLinkT[] = [
    {
      name: 'Home',
      href: `/${team}`,
      icon: <FaHome />,
      active: usePathname() === `/${team}`,
    },
    {
      name: 'Apps',
      href: `/${team}/apps`,
      icon: <FaCubes />,
      active: usePathname()?.split('/')[2] === 'apps',
    },
    {
      name: 'Integrations',
      href: `/${team}/integrations`,
      icon: <FaProjectDiagram />,
      active: usePathname() === `/${team}/integrations`,
    },
    {
      name: 'Access Control',
      href: `/${team}/access/members`,
      icon: <FaUsersCog />,
      active: usePathname()?.split('/')[2] === `access`,
    },
    {
      name: 'Settings',
      href: `/${team}/settings`,
      icon: <FaCog />,
      active: usePathname() === `/${team}/settings`,
    },
  ]

  return (
    <div className="h-screen flex flex-col pt-[64px] w-72">
      <nav className="flex flex-col divide-y divide-neutral-300 dark:divide-neutral-800 items-start justify-between h-full bg-neutral-100/70 dark:bg-neutral-800/20 text-black dark:text-white">
        <div className="gap-4 p-4 grid grid-cols-1 w-full">
          <OrgsMenu />

          {links.slice(0, 4).map((link) => (
            <SidebarLink
              key={link.name}
              name={link.name}
              href={link.href}
              icon={link.icon}
              active={link.active}
            />
          ))}
        </div>

        <div className="p-4 w-full">
          <SidebarLink
            key={links[4].name}
            name={links[4].name}
            href={links[4].href}
            icon={links[4].icon}
            active={links[4].active}
          />
        </div>
      </nav>
    </div>
  )
}

export default Sidebar
