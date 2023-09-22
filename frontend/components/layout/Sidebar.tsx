'use client'

import Link from 'next/link'
import UserMenu from '../UserMenu'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { FaCog, FaCubes, FaHome, FaUsersCog } from 'react-icons/fa'

export type SidebarLinkT = {
  name: string
  href: string
  icon: React.ReactNode
  active: boolean
}

const SidebarLink = (props: SidebarLinkT) => {
  const { name, href, icon, active } = props
  const iconStyles = 'hover:text-emerald-500'
  return (
    <Link href={href} title={name}>
      <div
        className={clsx(
          'flex items-center gap-2 hover:text-emerald-500 text-sm font-medium rounded-md p-2 w-56',
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
      active: usePathname() === `/${team}/apps`,
    },
    {
      name: 'Members',
      href: `/${team}/members`,
      icon: <FaUsersCog size="20" />,
      active: usePathname() === `/${team}/members`,
    },
    {
      name: 'Settings',
      href: `/${team}/settings`,
      icon: <FaCog size="20" />,
      active: usePathname() === `/${team}/settings`,
    },
  ]

  return (
    <nav className="h-screen flex flex-col divide-y divide-neutral-300 dark:divide-neutral-800 items-start justify-between pt-20 bg-neutral-100 dark:bg-zinc-900 text-black dark:text-white">
      <div className="gap-4 p-4 grid grid-cols-1">
        {links.slice(0, 3).map((link) => (
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
        {
          <SidebarLink
            key={links[3].name}
            name={links[3].name}
            href={links[3].href}
            icon={links[3].icon}
            active={links[3].active}
          />
        }
      </div>
    </nav>
  )
}

export default Sidebar
