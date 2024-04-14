import { AppType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { Menu, Transition } from '@headlessui/react'
import Link from 'next/link'
import { Fragment, useContext } from 'react'
import { FaServer } from 'react-icons/fa'
import { FaArrowDownUpLock } from 'react-icons/fa6'
import { Button } from '../common/Button'
import { close } from 'fs'
import clsx from 'clsx'

export const EncryptionModeIndicator = (props: { app: AppType }) => {
  const { app } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)

  return (
    <Menu as="div" className="relative inline-block text-left">
      <Menu.Button as="div" className="cursor-pointer" title="App encryption mode">
        {app.sseEnabled ? (
          <div className="rounded-full px-2 text-xs font-semibold flex items-center gap-2 ring-1 ring-inset ring-sky-400/40 text-sky-500 bg-sky-400/10">
            <FaServer />
            SSE
          </div>
        ) : (
          <div className="rounded-full px-2 text-xs font-semibold flex items-center gap-2 ring-1 ring-inset ring-emerald-400/40 text-emerald-500 bg-emerald-400/10">
            <FaArrowDownUpLock />
            E2EE
          </div>
        )}
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
        <Menu.Items className="absolute z-10 left-0 top-6 mt-2 w-72 origin-bottom-left divide-y divide-neutral-500/40 rounded-md bg-neutral-100 dark:bg-neutral-800 shadow-2xl ring-1 ring-inset ring-neutral-500/40 focus:outline-none">
          <div className="p-2">
            <Menu.Item>
              {({ close }) => (
                <div className="space-y-2 text-sm">
                  <div className="uppercase text-xs tracking-widest text-neutral-500">
                    App encryption mode
                  </div>
                  <div className="text-black dark:text-white">
                    This App is secured with{' '}
                    <span className={clsx(app.sseEnabled ? 'text-sky-500' : ' text-emerald-500')}>
                      {app.sseEnabled ? 'Server-side encryption' : 'End-to-end encryption'}
                    </span>
                  </div>
                  {app.sseEnabled ? (
                    <div className="flex items-center px-2 py-1 gap-2 text-sky-500 font-medium bg-sky-400/10 ring-1 ring-inset ring-sky-400/20 rounded-lg">
                      <FaServer />
                      <div>SSE enabled</div>
                    </div>
                  ) : (
                    <div className="flex items-center px-2 py-1 gap-2 text-emerald-500 font-medium bg-emerald-400/10 ring-1 ring-inset ring-emerald-400/20 rounded-lg">
                      <FaArrowDownUpLock />
                      <div>E2EE enabled</div>
                    </div>
                  )}
                  <div className="flex justify-end">
                    <Link href={`/${organisation?.name}/apps/${app.id}/settings`} onClick={close}>
                      <Button variant="outline">
                        <span className="text-xs">Manage</span>
                      </Button>
                    </Link>
                  </div>
                </div>
              )}
            </Menu.Item>
          </div>
        </Menu.Items>
      </Transition>
    </Menu>
  )
}
