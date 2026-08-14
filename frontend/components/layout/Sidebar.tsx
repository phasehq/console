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
  FaEllipsisH,
} from 'react-icons/fa'
import { organisationContext } from '@/contexts/organisationContext'
import { SidebarContext } from '@/contexts/sidebarContext'
import { Fragment, useContext, useEffect, useState } from 'react'
import { ApiOrganisationPlanChoices, OrganisationType } from '@/apollo/graphql'
import { Menu, Transition } from '@headlessui/react'
import { Button } from '../common/Button'
import { PlanLabel } from '../settings/organisation/PlanLabel'
import { FaListUl } from 'react-icons/fa6'

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
            'flex items-center gap-2 text-xs h-10 px-2.5 transition ease rounded-lg font-semibold whitespace-nowrap',
            collapsed ? 'justify-start' : '',
            active
              ? 'bg-zinc-300 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
              : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
          )}
        >
          <div className="text-lg">{icon}</div>

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
          <div className="invisible group-hover:visible absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-zinc-800 text-white px-2 py-1 rounded text-xs whitespace-nowrap z-50">
            {name}
          </div>
        )}
      </div>
    </Link>
  )
}

const MobileMoreMenu = ({
  overflowLinks,
  organisations,
  activeOrganisation,
  isOwner,
}: {
  overflowLinks: SidebarLinkT[]
  organisations: OrganisationType[] | null
  activeOrganisation: OrganisationType | null
  isOwner: boolean
}) => {
  return (
    <Menu as="div" className="relative flex-1 min-w-0">
      {({ open }) => (
        <>
          <Menu.Button
            className={clsx(
              'flex w-full h-14 flex-col items-center justify-center gap-0.5 px-1 transition-colors',
              open || overflowLinks.some((link) => link.active)
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-zinc-600 dark:text-zinc-400'
            )}
            aria-label="More navigation"
            title="More"
          >
            <FaEllipsisH className="text-lg" />
            <span className="text-[10px] font-medium">More</span>
          </Menu.Button>
          <Transition
            as={Fragment}
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 translate-y-1"
            enterTo="transform opacity-100 translate-y-0"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 translate-y-0"
            leaveTo="transform opacity-0 translate-y-1"
          >
            <Menu.Items className="absolute bottom-full right-2 mb-2 w-64 origin-bottom-right divide-y divide-neutral-500/40 rounded-md bg-neutral-200 p-1 shadow-2xl ring-1 ring-inset ring-neutral-500/40 focus:outline-none dark:bg-neutral-800">
              <div className="px-2 py-2 text-xs font-medium text-neutral-500">Organisation</div>
              <div className="py-1">
                {organisations?.map((org: OrganisationType) => (
                  <Menu.Item key={org.id}>
                    {({ active }) => (
                      <Link
                        href={`/${org.name}`}
                        className={clsx(
                          'flex items-center justify-between gap-2 rounded px-2 py-2 text-sm',
                          active && 'bg-neutral-100 dark:bg-neutral-700'
                        )}
                      >
                        <span className="truncate">{org.name}</span>
                        {org.id === activeOrganisation?.id && (
                          <span className="text-emerald-500">Current</span>
                        )}
                      </Link>
                    )}
                  </Menu.Item>
                ))}
                {!isOwner && (
                  <Menu.Item>
                    {({ active }) => (
                      <Link
                        href="/onboard"
                        className={clsx(
                          'flex items-center gap-3 rounded px-2 py-2 text-sm',
                          active && 'bg-neutral-100 dark:bg-neutral-700'
                        )}
                      >
                        <FaPlus />
                        Create New Organisation
                      </Link>
                    )}
                  </Menu.Item>
                )}
              </div>
              <div className="py-1">
                {overflowLinks.map((link) => (
                  <Menu.Item key={link.name}>
                    {({ active }) => (
                      <Link
                        href={link.href}
                        className={clsx(
                          'flex items-center gap-3 rounded px-2 py-2 text-sm',
                          active && 'bg-neutral-100 dark:bg-neutral-700',
                          link.active && 'text-emerald-600 dark:text-emerald-400'
                        )}
                      >
                        {link.icon}
                        {link.name}
                      </Link>
                    )}
                  </Menu.Item>
                ))}
              </div>
            </Menu.Items>
          </Transition>
        </>
      )}
    </Menu>
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
          'text-neutral-500 flex items-center transition-colors ease rounded-lg relative',
          collapsed
            ? `p-1 justify-center mb-[22px] ${planStyle()}`
            : 'p-2 justify-between w-full bg-neutral-500/10 ring-1 ring-inset ring-neutral-400/10'
        )}
      >
        {collapsed ? (
          <div className="w-8 h-8 flex items-center justify-center">
            <span className="font-bold text-lg">
              {activeOrganisation?.name?.[0]?.toUpperCase()}
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 min-w-0 items-start">
            <div>
              <PlanLabel plan={activeOrganisation?.plan!} />
            </div>
            <span className="truncate font-semibold tracking-wider text-base">
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
        {collapsed && !open && (
          <div className="invisible group-hover:visible absolute left-full ml-2 top-1/2 -translate-y-1/2 bg-zinc-800 text-white px-2 py-1 rounded text-xs whitespace-nowrap z-50">
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
              <Menu.Items
                className={clsx(
                  'absolute z-20 shadow-2xl divide-y divide-neutral-500/40 rounded-md bg-neutral-200 dark:bg-neutral-800 ring-1 ring-inset ring-neutral-500/40 focus:outline-none',
                  collapsed
                    ? 'left-full ml-2 top-0 w-56 origin-top-left'
                    : 'left-0 top-full mt-1 w-full origin-top-left'
                )}
              >
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
                              <span className="truncate text-left font-medium text-sm">
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
                    <Link href="/onboard">
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
      active: usePathname()?.split('/')[2] === `integrations`,
    },
    {
      name: 'Access Control',
      href: `/${team}/access/members`,
      icon: <FaUsersCog />,
      active: usePathname()?.split('/')[2] === `access`,
    },
    {
      name: 'Audit Logs',
      href: `/${team}/logs`,
      icon: <FaListUl />,
      active: usePathname()?.split('/')[2] === `logs`,
    },
    {
      name: 'Settings',
      href: `/${team}/settings`,
      icon: <FaCog />,
      active: usePathname() === `/${team}/settings`,
    },
  ]

  const mobileLinks = links.slice(0, 4)
  const overflowLinks = links.slice(4)

  return (
    <>
      <div
        className={clsx(
          'hidden h-dvh flex-col pt-12 transition-all duration-300 md:flex',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        <nav className="flex flex-col divide-y divide-neutral-300 dark:divide-neutral-800 items-start justify-between h-full bg-neutral-100/70 dark:bg-neutral-800/20 text-black dark:text-white">
          {/* Main navigation area */}
          <div className="gap-3 p-3 grid grid-cols-1 w-full">
            <div className={clsx(collapsed ? 'mb-2' : '')}>
              <OrgsMenu />
            </div>
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
          <div className="p-2 w-full">
            <button
              onClick={() => setUserPreference(collapsed ? 'expanded' : 'collapsed')}
              className="flex items-center justify-center p-1.5 w-full text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 rounded-lg"
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? (
                <FaAngleDoubleRight className="text-sm" />
              ) : (
                <FaAngleDoubleLeft className="text-sm" />
              )}
            </button>
          </div>
        </nav>
      </div>

      {/* z-10 keeps Headless UI dialogs (also z-10, portaled later in <body>) painting above the nav */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex h-[var(--mobile-tabbar-height)] items-start border-t border-neutral-300 bg-neutral-100/95 pb-[env(safe-area-inset-bottom)] text-zinc-600 backdrop-blur-md dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-zinc-400 md:hidden">
        {mobileLinks.map((link) => (
          <Link
            key={link.name}
            href={link.href}
            className={clsx(
              'flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 transition-colors',
              link.active
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'hover:text-zinc-900 dark:hover:text-zinc-100'
            )}
            aria-label={link.name}
            aria-current={link.active ? 'page' : undefined}
            title={link.name}
          >
            <span className="text-lg">{link.icon}</span>
            <span className="max-w-full truncate text-[10px] font-medium">
              {link.name === 'Access Control' ? 'Access' : link.name}
            </span>
          </Link>
        ))}
        <MobileMoreMenu
          overflowLinks={overflowLinks}
          organisations={organisations}
          activeOrganisation={activeOrganisation}
          isOwner={!!isOwner}
        />
      </nav>
    </>
  )
}

export default Sidebar
