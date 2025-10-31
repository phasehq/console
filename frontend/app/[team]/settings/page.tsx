'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Avatar } from '@/components/common/Avatar'
import { ModeToggle } from '@/components/common/ModeToggle'
import { TrustedDeviceManager } from '@/components/settings/account/TrustedDeviceManager'
import { ViewRecoveryDialog } from '@/components/settings/account/ViewRecoveryDialog'
import { RoleLabel } from '@/components/users/RoleLabel'
import { organisationContext } from '@/contexts/organisationContext'
import { PlanInfo } from '@/components/settings/organisation/PlanInfo'
import { userHasPermission, userIsAdmin } from '@/utils/access/permissions'
import { Tab } from '@headlessui/react'
import clsx from 'clsx'
import { useSession } from 'next-auth/react'
import { Fragment, useContext, useEffect, useState } from 'react'
import { FaMoon, FaSun } from 'react-icons/fa'
import Spinner from '@/components/common/Spinner'
import { ReleaseInfo } from '@/components/ReleaseInfo'

export default function Settings({ params }: { params: { team: string } }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const { activeOrganisation } = useContext(organisationContext)

  const { data: session } = useSession()

  const userCanManageBilling = activeOrganisation
    ? userHasPermission(activeOrganisation.role?.permissions, 'Billing', 'read') ||
      userHasPermission(activeOrganisation.role?.permissions, 'Billing', 'update') ||
      userHasPermission(activeOrganisation.role?.permissions, 'Billing', 'delete')
    : false

  const [tabIndex, setTabIndex] = useState(0)

  const tabList = [
    ...(userCanManageBilling ? [{ name: 'Organisation' }] : []),
    { name: 'Account' },
    { name: 'App' },
  ]

  useEffect(() => {
    const initialTabName = searchParams?.get('tab') ?? 'organisation'
    const initialTabIndex = tabList.findIndex(
      (tab) => tab.name.toLowerCase() === initialTabName.toLowerCase()
    )

    if (initialTabIndex !== -1) setTabIndex(initialTabIndex)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userCanManageBilling, searchParams])

  const updateTab = (index: number) => {
    const tab = tabList[index]
    const params = new URLSearchParams(searchParams?.toString())
    params.set('tab', tab.name)
    router.push(`${pathname}?${params.toString()}`)
  }

  if (!activeOrganisation)
    return (
      <div className="flex items-center justify-center py-40">
        <Spinner size="md" />
      </div>
    )

  return (
    <section className="w-full max-w-screen-lg mx-auto py-8 px-4 text-black dark:text-white">
      <h1 className="text-3xl font-semibold">Settings</h1>

      <div className="pt-8">
        <Tab.Group selectedIndex={tabIndex} onChange={(index) => updateTab(index)}>
          <Tab.List className="flex gap-4 w-full border-b border-neutral-500/20">
            {tabList.map((tab) => (
              <Tab key={tab.name} as={Fragment}>
                {({ selected }) => (
                  <div
                    className={clsx(
                      'p-3 font-medium border-b focus:outline-none text-black dark:text-white',
                      selected
                        ? 'border-emerald-500 font-semibold'
                        : 'border-transparent cursor-pointer'
                    )}
                  >
                    {tab.name}
                  </div>
                )}
              </Tab>
            ))}
          </Tab.List>

          <Tab.Panels>
            <div className="max-h-[80vh] overflow-y-auto px-4">
              {userCanManageBilling && (
                <Tab.Panel>
                  <div className="space-y-10 py-4">
                    <div className="space-y-1">
                      <h2 className="text-2xl font-semibold">Organisation</h2>
                      <p className="text-neutral-500">Organisation info and settings</p>
                    </div>
                    <PlanInfo />
                  </div>
                </Tab.Panel>
              )}

              <Tab.Panel>
                <div className="space-y-10 divide-y divide-neutral-500/40">
                  {activeOrganisation && (
                    <div className="space-y-6 py-4">
                      <div className="space-y-1">
                        <h2 className="text-2xl font-semibold">Account</h2>
                        <p className="text-neutral-500">Account information and recovery.</p>
                      </div>
                      <div className="py-4 whitespace-nowrap flex items-center gap-2">
                        <Avatar user={session?.user} size="xl" />
                        <div className="flex flex-col gap-2">
                          <div className="flex flex-col">
                            <span className="text-lg font-medium">{session?.user?.name}</span>
                            <span className="text-neutral-500 text-sm">{session?.user?.email}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            <RoleLabel role={activeOrganisation?.role!} />
                            <span>at {activeOrganisation?.name}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-4 border-t border-neutral-500/20 py-4">
                        <div className="text-lg font-medium">Recovery</div>
                        <ViewRecoveryDialog />
                      </div>
                      <TrustedDeviceManager />

                      <div className="flex flex-col gap-4 border-t border-neutral-500/20 py-4">
                        <div className="text-lg font-medium">Public key</div>
                        <code className="font-mono text-neutral-500 bg-zinc-300 dark:bg-zinc-800 p-4 rounded-md">
                          {activeOrganisation?.identityKey}
                        </code>
                      </div>
                    </div>
                  )}
                </div>
              </Tab.Panel>

              <Tab.Panel>
                <div className="space-y-8 h-[50vh]">
                  <div>
                    <h2 className="text-2xl font-semibold mb-2">App</h2>
                    <p className="text-neutral-500">
                      Control application-wide settings and view app information.
                    </p>
                  </div>
                  <div className="flex items-center gap-8">
                    <div className="font-semibold">Theme</div>
                    <div className="flex items-center gap-2 text-neutral-500">
                      <FaSun />
                      <ModeToggle />
                      <FaMoon />
                    </div>
                  </div>
                  <div>
                    <ReleaseInfo />
                  </div>
                </div>
              </Tab.Panel>
            </div>
          </Tab.Panels>
        </Tab.Group>
      </div>
    </section>
  )
}
