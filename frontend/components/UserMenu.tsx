'use client'

import { Menu, Transition } from '@headlessui/react'
import { Fragment, useContext } from 'react'
import clsx from 'clsx'
import { useSession } from '@/contexts/userContext'
import { MdLogout } from 'react-icons/md'
import { handleSignout } from '@/apollo/client'
import { Button } from './common/Button'
import { Avatar } from './common/Avatar'
import { FaMoon, FaPalette, FaShieldAlt, FaSun, FaUserCircle } from 'react-icons/fa'
import { ModeToggle } from './common/ModeToggle'
import { organisationContext } from '@/contexts/organisationContext'
import Link from 'next/link'
import { RoleLabel } from './users/RoleLabel'

const ROW_STYLE = 'flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs transition ease'
const ROW_TEXT = 'text-zinc-700 dark:text-zinc-300'
const ROW_ACTIVE = 'bg-zinc-900/5 dark:bg-white/5'
const ROW_ICON = 'size-3.5 shrink-0 text-neutral-500'

// themeInSidebar: md+ has the theme control in the sidebar, so the menu only keeps it below md
export default function UserMenu({ themeInSidebar = false }: { themeInSidebar?: boolean }) {
  const { data: session } = useSession()
  const { activeOrganisation } = useContext(organisationContext)

  const firstName = session?.user?.name?.split(' ')[0]

  if (!session) return <></>

  return (
    <div className="">
      <Menu as="div" className="relative inline-block text-left">
        <Menu.Button as="div">
          <Button variant="secondary">
            <Avatar user={session?.user} size="sm" />
            <div className="flex flex-col">{firstName}</div>
          </Button>
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
          <Menu.Items className="absolute z-20 right-0 top-full mt-2 w-60 origin-top-right divide-y divide-neutral-500/20 rounded-md bg-neutral-200 dark:bg-neutral-800 shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none">
            <div className="flex items-center gap-1.5 px-3 py-2.5">
              <Avatar user={session?.user} size="md" />
              <div className="flex flex-col flex-1 min-w-0">
                {/* The role wraps onto its own line rather than squeezing a long name */}
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <span className="min-w-0 truncate text-xs font-medium leading-5 text-zinc-900 dark:text-zinc-100">
                    {session?.user?.name}
                  </span>
                  {activeOrganisation?.role && (
                    <RoleLabel role={activeOrganisation.role} size="xs" />
                  )}
                </div>
                <span className="text-neutral-500 text-2xs leading-4 truncate">
                  {session?.user?.email}
                </span>
              </div>
            </div>

            <div className="p-1">
              <Menu.Item>
                {({ active }) => (
                  <Link href="/account" className={clsx(ROW_STYLE, ROW_TEXT, active && ROW_ACTIVE)}>
                    <FaUserCircle className={ROW_ICON} />
                    Account settings
                  </Link>
                )}
              </Menu.Item>
              {activeOrganisation && (
                <Menu.Item>
                  {({ active }) => (
                    <Link
                      href={`/${activeOrganisation.name}/settings?tab=account`}
                      title={`Account & security in ${activeOrganisation.name}`}
                      className={clsx(ROW_STYLE, ROW_TEXT, active && ROW_ACTIVE)}
                    >
                      <FaShieldAlt className={ROW_ICON} />
                      <span className="flex-1 whitespace-nowrap">Account &amp; security</span>
                      <span className="min-w-0 truncate text-2xs text-neutral-500">
                        {activeOrganisation.name}
                      </span>
                    </Link>
                  )}
                </Menu.Item>
              )}
              <div className={clsx(ROW_STYLE, ROW_TEXT, themeInSidebar && 'md:hidden')}>
                <FaPalette className={ROW_ICON} />
                <span className="flex-1">Theme</span>
                <div className="flex items-center gap-2 text-neutral-500">
                  <FaSun />
                  <ModeToggle />
                  <FaMoon />
                </div>
              </div>
            </div>

            <div className="p-1">
              <Menu.Item>
                {({ active }) => (
                  <button
                    type="button"
                    onClick={() => handleSignout()}
                    className={clsx(
                      ROW_STYLE,
                      'text-red-700 dark:text-red-400',
                      active && 'bg-red-500/10'
                    )}
                  >
                    <MdLogout className="size-3.5 shrink-0" />
                    Sign out
                  </button>
                )}
              </Menu.Item>
            </div>
          </Menu.Items>
        </Transition>
      </Menu>
    </div>
  )
}
