import { Disclosure, Transition } from '@headlessui/react'
import clsx from 'clsx'
import { FaArrowRight, FaChevronRight, FaPlus } from 'react-icons/fa'
import { SiCloudflare } from 'react-icons/si'
import { CreateSyncDialog } from './CreateSyncDialog'
import { Card } from '../common/Card'
import { Button } from '../common/Button'
import { ReactNode } from 'react'

interface Service {
  id: string
  name: string
  icon: ReactNode
}

const ServiceCard = (props: { service: Service }) => {
  const { service } = props

  return (
    <Card>
      <div className="flex flex-auto gap-4 cursor-pointer">
        <div className="text-4xl">{service.icon}</div>
        <div className="flex flex-col justify-center gap-6">
          <div>
            <div className="text-black dark:text-white text-lg font-semibold">{service.name}</div>
            <div className="text-neutral-500 text-sm">Sync an environment with {service.name}.</div>
          </div>
          <div className="text-emerald-500">
            <Button variant="link">
              Sync <FaArrowRight />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}

export const SyncOptions = (props: { defaultOpen: boolean; appId: string }) => {
  const { defaultOpen, appId } = props

  const syncOptions: Service[] = [
    {
      name: 'Cloudflare Pages',
      icon: <SiCloudflare className="text-[#F38020]" />,
      id: 'cloudflare_pages',
    },
  ]

  return (
    <Disclosure
      as="div"
      defaultOpen={defaultOpen}
      className="ring-1 ring-inset ring-neutral-500/40 rounded-md p-px flex flex-col divide-y divide-neutral-500/30 w-full"
    >
      {({ open }) => (
        <>
          <Disclosure.Button>
            <div
              className={clsx(
                'p-2 flex justify-between items-center gap-8 transition ease w-full',
                open
                  ? 'bg-zinc-200 dark:bg-zinc-800 rounded-t-md'
                  : 'bg-zinc-300 hover:bg-zinc-200 dark:bg-zinc-900 dark:hover:bg-zinc-800 rounded-md'
              )}
            >
              <div className="flex items-center gap-2">
                <FaPlus />
                <div className="font-semibold text-black dark:text-white">Create a new sync</div>
              </div>
              <FaChevronRight
                className={clsx(
                  'transform transition ease text-neutral-500',
                  open ? 'rotate-90' : 'rotate-0'
                )}
              />
            </div>
          </Disclosure.Button>

          <Transition
            enter="transition duration-100 ease-out"
            enterFrom="transform scale-95 opacity-0"
            enterTo="transform scale-100 opacity-100"
            leave="transition duration-75 ease-out"
            leaveFrom="transform scale-100 opacity-100"
            leaveTo="transform scale-95 opacity-0"
          >
            <Disclosure.Panel>
              <div className="p-4">
                <div className="space-y-8 ">
                  <div>
                    <h3 className="text-black dark:text-white text-2xl font-semibold">
                      Create a new sync
                    </h3>
                    <div className="text-neutral-500">Select a service below to start syncing.</div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-8">
                    {syncOptions.map((service) => (
                      <div key={service.name}>
                        <CreateSyncDialog
                          appId={appId}
                          service={service.id}
                          button={<ServiceCard service={service} />}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Disclosure.Panel>
          </Transition>
        </>
      )}
    </Disclosure>
  )
}
