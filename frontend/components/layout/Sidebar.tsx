'use client'

import Link from 'next/link'
import UserMenu from '../UserMenu'
import { usePathname } from 'next/navigation'
import clsx from 'clsx'
import { FaCog, FaCubes, FaHome } from 'react-icons/fa'

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
          'flex items-center gap-2 hover:text-emerald-500 text-xs rounded-md px-2 py-1',
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
      icon: <FaHome size="20" className="text-neutral-800 dark:text-neutral-300" />,
      active: usePathname() === `/${team}`,
    },
    {
      name: 'Apps',
      href: `/${team}/apps`,
      icon: <FaCubes size="20" className="text-neutral-800 dark:text-neutral-300" />,
      active: usePathname() === `/${team}/apps`,
    },
    {
      name: 'Settings',
      href: `/${team}/settings`,
      icon: <FaCog size="20" className="text-neutral-800 dark:text-neutral-300" />,
      active: usePathname() === `/${team}/settings`,
    },
  ]

  return (
    <nav className="flex flex-col divide-y divide-neutral-300 dark:divide-neutral-800 items-center justify-between pt-20 bg-neutral-100 dark:bg-neutral-900 text-black dark:text-white">
      <div className="gap-4 p-4 grid grid-cols-1 ">
        {links.slice(0, 2).map((link) => (
          <SidebarLink
            key={link.name}
            name={link.name}
            href={link.href}
            icon={link.icon}
            active={link.active}
          />
        ))}
      </div>
      <div className="py-4">
        {
          <SidebarLink
            key={links[2].name}
            name={links[2].name}
            href={links[2].href}
            icon={links[2].icon}
            active={links[2].active}
          />
        }
      </div>
    </nav>
  )
}

export default Sidebar
