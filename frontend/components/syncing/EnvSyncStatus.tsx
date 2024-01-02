import { EnvironmentSyncType, ApiEnvironmentSyncStatusChoices } from '@/apollo/graphql'
import { Menu, Transition } from '@headlessui/react'
import Link from 'next/link'
import { Fragment } from 'react'
import { FaSync, FaArrowRight } from 'react-icons/fa'
import { Button } from '../common/Button'
import { SyncCard } from './SyncCard'
import { SyncStatusIndicator } from './SyncStatusIndicator'

export const EnvSyncStatus = (props: {
  syncs: EnvironmentSyncType[]
  team: string
  app: string
}) => {
  const { syncs, team, app } = props

  const syncStatus = () => {
    if (
      syncs.some(
        (sync: EnvironmentSyncType) => sync.status === ApiEnvironmentSyncStatusChoices.Failed
      )
    )
      return ApiEnvironmentSyncStatusChoices.Failed
    else if (
      syncs.some(
        (sync: EnvironmentSyncType) => sync.status === ApiEnvironmentSyncStatusChoices.InProgress
      )
    )
      return ApiEnvironmentSyncStatusChoices.InProgress
    else return ApiEnvironmentSyncStatusChoices.Completed
  }

  if (syncs.length > 0) {
    return (
      <Menu as="div" className="relative inline-block text-left">
        {({ open }) => (
          <>
            <Menu.Button
              as="div"
              className="p-2 text-neutral-500 font-semibold uppercase tracking-wider cursor-pointer flex items-center justify-between"
            >
              <SyncStatusIndicator status={syncStatus()} />
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
              <Menu.Items className="absolute z-20 -right-2 top-12 w-[512px] md:w-[768px] origin-top-right divide-y divide-neutral-500/40 rounded-md bg-neutral-200/40 dark:bg-neutral-800/40 backdrop-blur-md shadow-2xl focus:outline-none">
                <div className="p-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-black dark:text-white font-medium text-lg flex items-center gap-2">
                        <FaSync />
                        Syncs
                      </div>
                      <Link href={`/${team}/apps/${app}/syncing`}>
                        <Button variant="secondary">
                          Explore
                          <FaArrowRight />
                        </Button>
                      </Link>
                    </div>
                    {syncs.map((sync: EnvironmentSyncType) => (
                      <SyncCard key={sync.id} sync={sync} />
                    ))}
                  </div>
                </div>
              </Menu.Items>
            </Transition>
          </>
        )}
      </Menu>
    )
  } else return <></>
}
