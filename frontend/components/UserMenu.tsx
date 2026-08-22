'use client'

import { Menu, Transition } from '@headlessui/react'
import { Fragment, useContext } from 'react'
import { useSession } from '@/contexts/userContext'
import { MdLogout } from 'react-icons/md'
import { handleSignout } from '@/apollo/client'
import { Button } from './common/Button'
import { Avatar } from './common/Avatar'
import { FaSun, FaMoon, FaCog, FaUserCircle } from 'react-icons/fa'
import { ModeToggle } from './common/ModeToggle'
import { organisationContext } from '@/contexts/organisationContext'
import Link from 'next/link'
import { RoleLabel } from './users/RoleLabel'

export default function UserMenu() {
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
          <Menu.Items className="absolute z-20 -right-2 top-12 mt-2 w-72 origin-bottom-left divide-y divide-neutral-500/20 rounded-md bg-neutral-200 dark:bg-neutral-800 shadow-lg ring-1 ring-inset ring-neutral-500/40 focus:outline-none">
            {/* Account: profile + account settings */}
            <div className="flex flex-col gap-2 p-2">
              <div className="flex items-start gap-2 py-2">
                <div className="py-1.5">
                  <Avatar user={session?.user} size="md" />
                </div>
                <div className="flex flex-col flex-grow min-w-0">
                  <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {session?.user?.name}
                  </span>
                  <span className="text-neutral-500 text-2xs truncate">{session?.user?.email}</span>
                </div>
              </div>
              <Menu.Item>
                {/* self-start: keep the clickable area to the button, not the row */}
                <Link href="/account" className="self-start">
                  <Button variant="outline" icon={FaUserCircle}>
                    Account settings
                  </Button>
                </Link>
              </Menu.Item>
            </div>

            {/* Current organisation: role/name + org settings */}
            {activeOrganisation && (
              <div className="flex flex-col gap-2 p-2">
                <div className="flex items-center gap-1 text-2xs px-1 pt-1">
                  <RoleLabel role={activeOrganisation.role!} /> @{' '}
                  <span className="text-zinc-900 dark:text-zinc-100 truncate">
                    {activeOrganisation.name}
                  </span>
                </div>
                <Menu.Item>
                  <Link href={`/${activeOrganisation.name}/settings`} className="self-start">
                    <Button variant="outline" icon={FaCog}>
                      Org settings
                    </Button>
                  </Link>
                </Menu.Item>
              </div>
            )}

            {/* Theme + sign out on a single row */}
            <div className="flex items-center justify-between gap-2 p-2">
              <div className="flex items-center gap-2 text-neutral-500">
                <FaSun />
                <ModeToggle />
                <FaMoon />
              </div>
              <Menu.Item>
                <Button variant="danger" icon={MdLogout} onClick={() => handleSignout()}>
                  Sign out
                </Button>
              </Menu.Item>
            </div>
          </Menu.Items>
        </Transition>
      </Menu>
    </div>
  )
}
