'use client'

import Spinner from '@/components/common/Spinner'
import KMSLogs from '@/components/logs/KmsLogs'
import SecretLogs from '@/components/logs/SecretLogs'
import { organisationContext } from '@/contexts/organisationContext'
import { Tab } from '@headlessui/react'
import clsx from 'clsx'
import { useState, Fragment, useContext } from 'react'

// The historical start date for all log data (May 1st, 2023)
const LOGS_START_DATE = 1682904457000

export default function Logs({ params }: { params: { team: string; app: string } }) {
  const [tabIndex, setTabIndex] = useState(0)
  const { activeOrganisation: organisation } = useContext(organisationContext)

  const tabs = [
    {
      label: 'Secrets',
      component: <SecretLogs app={params.app} />,
    },
    {
      label: 'KMS',
      component: <KMSLogs app={params.app} />,
    },
  ]

  if (!organisation)
    return (
      <div className="h-full max-h-screen overflow-y-auto w-full flex items-center justify-center">
        <Spinner size="md" />
      </div>
    )

  return (
    <div className="h-screen overflow-y-auto w-full text-black dark:text-white flex flex-col px-8">
      {organisation?.role!.name!.toLowerCase() === 'owner' ? (
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
                    {tab.label}{' '}
                    {tab.label === 'KMS' && (
                      <span className="rounded-full bg-purple-200 dark:bg-purple-900/50 text-neutral-800 dark:text-neutral-300 px-2 py-0.5 text-2xs">
                        Legacy
                      </span>
                    )}
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
      ) : (
        <SecretLogs app={params.app} />
      )}
    </div>
  )
}
