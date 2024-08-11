'use client'

import { Menu, Transition } from '@headlessui/react'
import { Fragment, useContext } from 'react'
import { useSession } from 'next-auth/react'
import { MdLogout } from 'react-icons/md'
import { handleSignout } from '@/apollo/client'
import { Button } from './common/Button'
import { Avatar } from './common/Avatar'
import { FaSun, FaMoon, FaCog } from 'react-icons/fa'
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
            <Avatar imagePath={session?.user?.image} size="sm" />
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
            <Menu.Item>
              <div className="py-4 flex items-start gap-2 p-2">
                <div className="py-1.5">
                  <Avatar imagePath={session?.user?.image!} size="md" />
                </div>
                <div className="flex flex-col flex-grow min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {session?.user?.name}
                    </span>
                  </div>
                  <span className="text-neutral-500 text-2xs truncate">{session?.user?.email}</span>
                  {activeOrganisation && (
                    <div className="flex items-center gap-1 text-2xs pt-1">
                      {activeOrganisation && <RoleLabel role={activeOrganisation?.role!} />} @{' '}
                      <span className="text-zinc-900 dark:text-zinc-100  truncate">
                        {activeOrganisation?.name}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </Menu.Item>

            <Menu.Item>
              <div className="flex items-center justify-between px-2 py-3 text-neutral-500">
                <div className="text-2xs">Theme</div>
                <div className="flex items-center gap-2">
                  <FaSun />
                  <ModeToggle />
                  <FaMoon />
                </div>
              </div>
            </Menu.Item>

            <Menu.Item>
              <div className="flex items-center justify-between p-2">
                <div>
                  {activeOrganisation && (
                    <Link href={`/${activeOrganisation.name}/settings`}>
                      <Button variant="outline">
                        <div className="flex items-center gap-1 text-xs">
                          <FaCog />
                          Settings
                        </div>
                      </Button>
                    </Link>
                  )}
                </div>
                <Button
                  variant="danger"
                  onClick={() => handleSignout({ callbackUrl: `${window.location.origin}` })}
                >
                  <div className="flex items-center gap-1 text-xs">
                    <MdLogout />
                    Sign out
                  </div>
                </Button>
              </div>
            </Menu.Item>
          </Menu.Items>
        </Transition>
      </Menu>
    </div>
  )
}
