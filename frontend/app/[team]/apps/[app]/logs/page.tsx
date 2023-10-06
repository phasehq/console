'use client'

import KMSLogs from '@/components/logs/KmsLogs'
import SecretLogs from '@/components/logs/SecretLogs'
import { Tab } from '@headlessui/react'
import clsx from 'clsx'
import { useState, Fragment } from 'react'

// The historical start date for all log data (May 1st, 2023)
const LOGS_START_DATE = 1682904457000

export default function Logs({ params }: { params: { team: string; app: string } }) {
  const [tabIndex, setTabIndex] = useState(0)

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

  return (
    <div className="h-screen overflow-y-auto w-full text-black dark:text-white flex flex-col">
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
            <Tab.Panel key={tab.label}>{tab.component}</Tab.Panel>
          ))}
        </Tab.Panels>
      </Tab.Group>
    </div>
  )
}
