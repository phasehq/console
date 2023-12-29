import { EnvironmentSyncType, ServiceType } from '@/apollo/graphql'
import { Dialog, Tab, Transition } from '@headlessui/react'
import { useState, Fragment, ReactNode } from 'react'
import { FaAngleDoubleRight, FaCube, FaTimes } from 'react-icons/fa'
import { Button } from '../common/Button'
import { SyncManagement } from './SyncManagement'
import { SyncHistory } from './SyncHistory'
import clsx from 'clsx'
import { SiCloudflare } from 'react-icons/si'

export const ManageSyncDialog = (props: { sync: EnvironmentSyncType; button: ReactNode }) => {
  const { sync, button } = props

  const [tabIndex, setTabIndex] = useState(0)

  const tabs = [
    {
      label: 'Manage',
      component: <SyncManagement sync={sync} />,
    },
    {
      label: 'History',
      component: <SyncHistory history={sync.history} />,
    },
  ]

  const [isOpen, setIsOpen] = useState<boolean>(false)

  const closeModal = () => {
    setIsOpen(false)
  }

  const openModal = () => {
    setIsOpen(true)
  }

  const serviceIcon = (service: ServiceType) => {
    if (service.id!.toLowerCase() === 'cloudflare_pages')
      return <SiCloudflare className="shrink-0" />
    else return <FaCube />
  }

  return (
    <>
      <div className="cursor-pointer" onClick={openModal}>
        {button}
      </div>
      <Transition appear show={isOpen} as={Fragment}>
        <Dialog as="div" className="relative z-10" onClose={closeModal}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/25 backdrop-blur-md" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-screen-md transform rounded-2xl bg-white dark:bg-neutral-900 p-6 text-left align-middle shadow-xl transition-all">
                  <Dialog.Title as="div" className="flex w-full justify-between">
                    <h3 className="text-lg leading-6 text-neutral-500">Manage sync</h3>

                    <Button variant="text" onClick={closeModal}>
                      <FaTimes className="text-zinc-900 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300" />
                    </Button>
                  </Dialog.Title>
                  <div className="pt-4">
                    <div className="flex col-span-2 gap-4 items-center justify-between p-4 border border-neutral-500/40 bg-zinc-200 dark:bg-zinc-800 rounded-md">
                      <div className="flex flex-col text-xl">
                        <span className="text-black dark:text-white font-semibold">
                          {sync.environment.app.name}{' '}
                        </span>

                        <span className="tracking-wider text-base text-neutral-500">
                          {sync.environment.envType}
                        </span>
                      </div>

                      <div>
                        <FaAngleDoubleRight className="text-neutral-500 text-xl justify-self-end" />
                      </div>

                      <div className="text-xl">
                        <div className="flex gap-2 items-center font-semibold">
                          {serviceIcon(sync.serviceInfo!)}
                          <div>{sync.serviceInfo?.name}</div>
                        </div>
                        <div className="flex gap-2 text-base">
                          {JSON.parse(sync.options)['project_name']}
                          <span className="text-neutral-500 font-normal">
                            ({JSON.parse(sync.options)['environment']})
                          </span>
                        </div>
                      </div>
                    </div>
                    <Tab.Group selectedIndex={tabIndex} onChange={(index) => setTabIndex(index)}>
                      <Tab.List className="flex gap-4 w-full border-b border-neutral-500/20">
                        {tabs.map((tab) => (
                          <Tab as={Fragment} key={tab.label}>
                            {({ selected }) => (
                              <div
                                className={clsx(
                                  'p-3 font-medium border-b focus:outline-none',
                                  selected
                                    ? 'border-emerald-500 font-semibold'
                                    : ' border-transparent cursor-pointer'
                                )}
                              >
                                {tab.label}
                              </div>
                            )}
                          </Tab>
                        ))}
                      </Tab.List>
                      <Tab.Panels>
                        {tabs.map((tab) => (
                          <div key={tab.label} className="max-h-[80vh] overflow-y-auto">
                            <Tab.Panel>{tab.component}</Tab.Panel>
                          </div>
                        ))}
                      </Tab.Panels>
                    </Tab.Group>
                  </div>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
