'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import {
  FaCog,
  FaCubes,
  FaExchangeAlt,
  FaHome,
  FaPlus,
  FaUsersCog,
  FaProjectDiagram,
  FaAngleDoubleLeft,
  FaAngleDoubleRight,
  FaChevronDown,
} from 'react-icons/fa'
import { organisationContext } from '@/contexts/organisationContext'
import { SidebarContext } from '@/contexts/sidebarContext'
import { Fragment, useContext, useEffect, useState } from 'react'
import { ApiOrganisationPlanChoices, OrganisationType } from '@/apollo/graphql'
import { Menu, Transition } from '@headlessui/react'
import { Button } from '../common/Button'
import { PlanLabel } from '../settings/organisation/PlanLabel'

export type SidebarLinkT = {
  name: string
  href: string
  icon: React.ReactNode
  active: boolean
}

const SidebarLink = ({
  name,
  href,
  icon,
  active,
  collapsed,
}: SidebarLinkT & { collapsed: boolean }) => {
  return (
    <Link href={href}>
      <div className="relative group">
        <div
          className={clsx(
            'flex items-center gap-2 text-sm h-12 px-3 transition ease rounded-lg font-semibold whitespace-nowrap',
            collapsed ? 'justify-start' : '',
            active
              ? 'bg-zinc-300 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
              : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
          )}
        >
          <div className="text-xl">{icon}</div>

          <Transition
            as="div"
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0"
            enterTo="transform opacity-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100"
            leaveTo="transform opacity-0"
            show={!collapsed}
          >
            {' '}
            {name}{' '}
          </Transition>
        </div>
        {collapsed && (
          <div className="invisible group-hover:visible absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-zinc-800 text-white px-2 py-1 rounded text-sm whitespace-nowrap z-50">
            {name}
          </div>
        )}
      </div>
    </Link>
  )
}

const Sidebar = () => {
  const { sidebarState, setUserPreference } = useContext(SidebarContext)
  const [isAutoCollapsed, setIsAutoCollapsed] = useState(false)
  const collapsed = isAutoCollapsed || sidebarState === 'collapsed'
  const team = usePathname()?.split('/')[1]
  const { organisations, activeOrganisation } = useContext(organisationContext)
  const showOrgsMenu = organisations && organisations.length > 1
  const isOwner = organisations?.some((org) => org.role!.name!.toLowerCase() === 'owner')

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 1024) {
        setIsAutoCollapsed(true) // Auto-collapse
      } else {
        setIsAutoCollapsed(false) // Reset auto-collapse
      }
    }

    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const OrgsMenu = () => {
    const planStyle = () => {
      if (activeOrganisation?.plan === ApiOrganisationPlanChoices.Fr)
        return 'ring-neutral-500/40 bg-neutral-500/40 text-zinc-900 dark:bg-zinc-800 dark:text-neutral-500'
      if (activeOrganisation?.plan === ApiOrganisationPlanChoices.Pr)
        return 'ring-emerald-400/10 bg-emerald-400 text-zinc-900 dark:bg-emerald-400/10 dark:text-emerald-400'
      if (activeOrganisation?.plan === ApiOrganisationPlanChoices.En)
        return 'ring-amber-400/10 bg-amber-400 text-zinc-900 dark:bg-amber-400/10 dark:text-amber-400'
    }

    const OrgLabel = ({ open }: { open?: boolean }) => (
      <div
        className={clsx(
          'p-2 text-neutral-500 flex items-center transition-colors ease rounded-lg relative',
          collapsed
            ? `justify-center mb-[22px] ${planStyle()}`
            : 'justify-between w-full bg-neutral-500/10 ring-1 ring-inset ring-neutral-400/10'
        )}
      >
        {collapsed ? (
          <div className="w-8 h-8 flex items-center justify-center">
            <span className="font-bold text-xl">
              {activeOrganisation?.name?.[0]?.toUpperCase()}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 min-w-0 items-start">
            <div>
              <PlanLabel plan={activeOrganisation?.plan!} />
            </div>
            <span className="truncate font-semibold tracking-wider text-lg">
              {activeOrganisation?.name}
            </span>
          </div>
        )}
        {showOrgsMenu && !collapsed && (
          <FaChevronDown
            className={clsx(
              'text-neutral-500 opacity-0 group-hover:opacity-100 transition transform ease',
              open ? 'rotate-180' : 'rotate-0'
            )}
          />
        )}
        {collapsed && (
          <div className="invisible group-hover:visible absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-zinc-800 text-white px-2 py-1 rounded text-sm whitespace-nowrap z-50">
            {activeOrganisation?.name}
          </div>
        )}
      </div>
    )

    if (!showOrgsMenu) return <OrgLabel />

    return (
      <Menu
        as="div"
        className={clsx('relative group inline-block text-left', collapsed ? '' : 'w-full')}
      >
        {({ open }) => (
          <>
            <Menu.Button className={collapsed ? '' : 'w-full flex items-center'}>
              <OrgLabel open={open} />
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
              <Menu.Items className="absolute z-20 left-0 shadow-2xl top-16 mt-2 w-64 origin-bottom-left divide-y divide-neutral-500/40 rounded-md bg-neutral-200 dark:bg-neutral-800 ring-1 ring-inset ring-neutral-500/40 focus:outline-none">
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
      href: `/${team}/integrations/syncs`,
      icon: <FaProjectDiagram />,
      active: usePathname() === `/${team}/integrations/syncs`,
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
    <div
      className={clsx(
        'h-screen flex flex-col pt-[64px] transition-all duration-300',
        collapsed ? 'w-20' : 'w-72'
      )}
    >
      <nav className="flex flex-col divide-y divide-neutral-300 dark:divide-neutral-800 items-start justify-between h-full bg-neutral-100/70 dark:bg-neutral-800/20 text-black dark:text-white">
        {/* Main navigation area */}
        <div className="gap-4 p-4 grid grid-cols-1 w-full">
          <OrgsMenu />
          {links.map((link) => (
            <SidebarLink
              key={link.name}
              name={link.name}
              href={link.href}
              icon={link.icon}
              active={link.active}
              collapsed={collapsed}
            />
          ))}
        </div>

        {/* Bottom section with collapse/expand button */}
        <div className="p-4 w-full">
          <button
            onClick={() => setUserPreference(collapsed ? 'expanded' : 'collapsed')}
            className="flex items-center justify-center p-3 w-full text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-lg"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <FaAngleDoubleRight className="text-xl" />
            ) : (
              <FaAngleDoubleLeft className="text-xl" />
            )}
          </button>
        </div>
      </nav>
    </div>
  )
}

export default Sidebar
