'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
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
          'flex items-center gap-2 hover:text-emerald-500 text-sm font-medium rounded-md p-2 w-full',
          active && 'bg-neutral-300 dark:bg-neutral-800'
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

  const { organisations, activeOrganisation, setActiveOrganisation } =
    useContext(organisationContext)

  const showOrgsMenu = organisations === null ? false : organisations?.length > 1

  const OrgsMenu = () => {
    const switchOrg = (org: OrganisationType) => {
      setActiveOrganisation(org)
    }

    return (
      <Menu as="div" className="relative inline-block text-left ">
        {({ open }) => (
          <>
            <Menu.Button
              as="div"
              className="p-2 text-neutral-500 font-semibold uppercase tracking-wider cursor-pointer flex items-center justify-between w-full"
            >
              <span className="truncate">{activeOrganisation?.name}</span>
              <FaChevronDown
                className={clsx('transition ease', open ? 'rotate-180' : 'rotate-0')}
              />
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
              <Menu.Items className="absolute z-10 -right-2 top-12 mt-2 w-56 origin-bottom-left divide-y divide-neutral-500/40 rounded-md bg-neutral-200 dark:bg-neutral-800 shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none">
                {showOrgsMenu ? (
                  <div className="px-1 py-1">
                    {organisations?.map((org: OrganisationType) => (
                      <Menu.Item key={org.id}>
                        {({ active }) => (
                          <button
                            onClick={() => switchOrg(org)}
                            title={`Switch to ${org.name}`}
                            className={`${
                              active
                                ? 'hover:text-emerald-500 dark:text-white dark:hover:text-emerald-500'
                                : 'text-gray-900 dark:text-white dark:hover:text-emerald-500'
                            } group flex w-full  gap-2 items-center justify-between rounded-md px-2 py-2 text-base font-medium`}
                          >
                            <span className="truncate w-[80%] text-left">{org.name}</span>
                            <FaExchangeAlt />
                          </button>
                        )}
                      </Menu.Item>
                    ))}
                  </div>
                ) : null}
                <div className="py-3 px-1 flex justify-center">
                  <Link href="/signup">
                    <Button variant="secondary">
                      <FaPlus /> Create New Organisation
                    </Button>
                  </Link>
                </div>
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
      icon: <FaHome size="20" />,
      active: usePathname() === `/${team}`,
    },
    {
      name: 'Apps',
      href: `/${team}/apps`,
      icon: <FaCubes size="20" />,
      active: usePathname()?.split('/')[2] === 'apps',
    },
    {
      name: 'Members',
      href: `/${team}/members`,
      icon: <FaUsersCog size="20" />,
      active: usePathname() === `/${team}/members`,
    },
    {
      name: 'Integrations',
      href: `/${team}/integrations`,
      icon: <FaProjectDiagram size="20" />,
      active: usePathname() === `/${team}/integrations`,
    },
    {
      name: 'Personal access tokens',
      href: `/${team}/tokens`,
      icon: <FaKey size="20" />,
      active: usePathname() === `/${team}/tokens`,
    },
    {
      name: 'Settings',
      href: `/${team}/settings`,
      icon: <FaCog size="20" />,
      active: usePathname() === `/${team}/settings`,
    },
  ]

  return (
    <div className="h-screen flex flex-col pt-[64px] w-72">
      <nav className="flex flex-col divide-y divide-neutral-300 dark:divide-neutral-800 items-start justify-between h-full bg-neutral-100/30 dark:bg-neutral-900/30 text-black dark:text-white">
        <div className="gap-4 p-4 grid grid-cols-1 w-full">
          <OrgsMenu />

          {links.slice(0, 5).map((link) => (
            <SidebarLink
              key={link.name}
              name={link.name}
              href={link.href}
              icon={link.icon}
              active={link.active}
            />
          ))}
        </div>
        <div className="p-4">
          <SidebarLink
            key={links[5].name}
            name={links[5].name}
            href={links[5].href}
            icon={links[5].icon}
            active={links[5].active}
          />
        </div>
      </nav>
    </div>
  )
}

export default Sidebar
