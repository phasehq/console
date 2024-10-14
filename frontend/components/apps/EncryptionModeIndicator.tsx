import { AppType } from '@/apollo/graphql'
import { organisationContext } from '@/contexts/organisationContext'
import { Menu, Transition } from '@headlessui/react'
import Link from 'next/link'
import { Fragment, useContext } from 'react'
import { FaCog, FaServer } from 'react-icons/fa'
import { FaArrowDownUpLock } from 'react-icons/fa6'
import { Button } from '../common/Button'
import clsx from 'clsx'
import app from 'next/app'
import { userHasPermission } from '@/utils/access/permissions'

export const SseLabel = ({ sseEnabled }: { sseEnabled: boolean }) => (
  <div
    className={clsx(
      'rounded-md px-2 text-2xs font-semibold flex items-center gap-1',
      sseEnabled ? 'text-sky-500 bg-sky-400/10' : 'text-emerald-500 bg-emerald-400/10'
    )}
  >
    {sseEnabled ? <FaServer /> : <FaArrowDownUpLock />}
    {sseEnabled ? 'SSE' : 'E2EE'}
  </div>
)

export const EncryptionModeIndicator = (props: { app: AppType; asMenu?: boolean }) => {
  const { app, asMenu } = props

  const { activeOrganisation: organisation } = useContext(organisationContext)

  const userCanReadEncMode = userHasPermission(
    organisation?.role?.permissions,
    'EncryptionMode',
    'read',
    true
  )

  if (asMenu === false) return <SseLabel sseEnabled={app.sseEnabled!} />

  if (!userCanReadEncMode) return <></>

  return (
    <Menu as="div" className="relative inline-block text-left">
      <Menu.Button
        as="div"
        className="cursor-pointer"
        title={app.sseEnabled ? 'Server-side encryption enabled' : 'End-to-end encryption enabled'}
      >
        <SseLabel sseEnabled={app.sseEnabled!} />
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
                  <div className="flex items-center justify-between">
                    <div className="uppercase text-xs tracking-widest text-neutral-500">
                      App encryption mode
                    </div>
                    <SseLabel sseEnabled={app.sseEnabled!} />
                  </div>

                  <div className="text-black dark:text-white">
                    This App is secured with{' '}
                    <span className="font-medium">
                      {app.sseEnabled ? 'Server-side encryption' : 'End-to-end encryption'}
                    </span>
                    .
                  </div>

                  <div className="flex justify-end">
                    <Link href={`/${organisation?.name}/apps/${app.id}/settings`} onClick={close}>
                      <Button variant="outline">
                        <FaCog />
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
