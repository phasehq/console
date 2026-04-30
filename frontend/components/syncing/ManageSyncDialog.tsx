import { EnvironmentSyncType } from '@/apollo/graphql'
import { Tab } from '@headlessui/react'
import { useState, Fragment, ReactNode, useRef } from 'react'
import { FaAngleDoubleRight } from 'react-icons/fa'
import { SyncManagement } from './SyncManagement'
import { SyncHistory } from './SyncHistory'
import clsx from 'clsx'
import { ProviderIcon } from './ProviderIcon'
import { ServiceInfo } from './ServiceInfo'
import GenericDialog from '@/components/common/GenericDialog'

export const ManageSyncDialog = (props: { sync: EnvironmentSyncType; button: ReactNode }) => {
  const { sync, button } = props

  const [tabIndex, setTabIndex] = useState(0)
  const dialogRef = useRef<{ closeModal: () => void; openModal: () => void }>(null)

  const closeModal = () => dialogRef.current?.closeModal()

  const tabs = [
    {
      label: 'Manage',
      component: <SyncManagement sync={sync} closeModal={closeModal} />,
    },
    {
      label: 'History',
      component: <SyncHistory history={sync.history} />,
    },
  ]

  return (
    <>
      <div className="cursor-pointer" onClick={() => dialogRef.current?.openModal()}>
        {button}
      </div>
      <GenericDialog ref={dialogRef} title="Manage sync" size="md">
        <div className="pt-4">
          <div className="flex col-span-2 gap-3 items-center justify-between p-3 border border-neutral-500/40 bg-zinc-200 dark:bg-zinc-800 rounded-md">
            <div className="flex flex-col text-sm">
              <span className="text-black dark:text-white font-semibold">
                {sync.environment.app.name}{' '}
              </span>

              <span className="tracking-wider text-2xs text-neutral-500">
                {sync.environment.name}
              </span>
            </div>

            <div>
              <FaAngleDoubleRight className="text-neutral-500 text-sm justify-self-end" />
            </div>

            <div className="text-sm text-black dark:text-white">
              <div className="flex gap-2 items-center font-semibold">
                <ProviderIcon providerId={sync.serviceInfo!.id!} />
                <div>{sync.serviceInfo?.name}</div>
              </div>
              <div className="text-2xs">
                <ServiceInfo sync={sync} />
              </div>
            </div>
          </div>
          <Tab.Group selectedIndex={tabIndex} onChange={(index) => setTabIndex(index)}>
            <Tab.List className="flex gap-2 w-full border-b border-neutral-500/20">
              {tabs.map((tab) => (
                <Tab as={Fragment} key={tab.label}>
                  {({ selected }) => (
                    <div
                      className={clsx(
                        'p-2 text-xs font-medium border-b focus:outline-none text-black dark:text-white',
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
                <Tab.Panel key={tab.label}>{tab.component}</Tab.Panel>
              ))}
            </Tab.Panels>
          </Tab.Group>
        </div>
      </GenericDialog>
    </>
  )
}
